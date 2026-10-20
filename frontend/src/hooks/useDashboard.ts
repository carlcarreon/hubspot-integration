import { useCallback, useEffect, useRef, useState } from 'react';
import { statusOptions } from '../components/dashboard/DashboardControls';
import type { AttemptHistory, DashboardView, PageLimit, StatusFilter } from '../components/dashboard/types';
import {
  DashboardApiError,
  downloadDealsCsv,
  getOrderAttempts,
  getOrders,
  getStats,
  getSyncs,
  retryOrder,
  type DashboardStats,
  type OrdersPage,
  type Pagination,
  type SyncAttemptsPage,
} from '../services/dashboard-api';

type UrlState = {
  view: DashboardView;
  status: StatusFilter;
  q: string;
  page: number;
  limit: PageLimit;
};

const emptyPagination: Pagination = { page: 1, limit: 20, totalItems: 0, totalPages: 0 };
const emptyPage: OrdersPage = { data: [], pagination: emptyPagination };
const emptyAttemptsPage: SyncAttemptsPage = { data: [], pagination: emptyPagination };

export function useDashboard() {
  const initialUrlState = readUrlState();
  const skipSearchDebounce = useRef(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [view, setView] = useState<DashboardView>(initialUrlState.view);
  const [ordersPage, setOrdersPage] = useState<OrdersPage>(emptyPage);
  const [attemptsPage, setAttemptsPage] = useState<SyncAttemptsPage>(emptyAttemptsPage);
  const [status, setStatus] = useState<StatusFilter>(initialUrlState.status);
  const [query, setQuery] = useState(initialUrlState.q);
  const [search, setSearch] = useState(initialUrlState.q);
  const [page, setPage] = useState(initialUrlState.page);
  const [limit, setLimit] = useState<PageLimit>(initialUrlState.limit);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistory>({});
  const [attemptHistoryLoading, setAttemptHistoryLoading] = useState<string | null>(null);
  const [attemptHistoryErrors, setAttemptHistoryErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
  const [retryOrderId, setRetryOrderId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextStats = getStats();
      if (view === 'orders') {
        const [resolvedStats, nextOrders] = await Promise.all([
          nextStats,
          getOrders(status || undefined, search, limit, page),
        ]);
        setStats(resolvedStats);
        setOrdersPage(nextOrders);
        if (nextOrders.pagination.page !== page) {
          setPage(nextOrders.pagination.page);
          writeUrlState({ view, status, q: search, page: nextOrders.pagination.page, limit }, 'replace');
        }
      } else {
        const [resolvedStats, nextAttempts] = await Promise.all([
          nextStats,
          getSyncs(status || undefined, search, limit, page),
        ]);
        setStats(resolvedStats);
        setAttemptsPage(nextAttempts);
        if (nextAttempts.pagination.page !== page) {
          setPage(nextAttempts.pagination.page);
          writeUrlState({ view, status, q: search, page: nextAttempts.pagination.page, limit }, 'replace');
        }
      }
    } catch (caughtError) {
      setError(readError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [limit, page, search, status, view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const restoreStateFromHistory = (): void => {
      const restored = readUrlState();
      skipSearchDebounce.current = true;
      setView(restored.view);
      setStatus(restored.status);
      setQuery(restored.q);
      setSearch(restored.q);
      setPage(restored.page);
      setLimit(restored.limit);
      setExpandedOrderId(null);
    };

    window.addEventListener('popstate', restoreStateFromHistory);
    return () => window.removeEventListener('popstate', restoreStateFromHistory);
  }, []);

  useEffect(() => {
    if (skipSearchDebounce.current) {
      skipSearchDebounce.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      setSearch(query);
      setPage(1);
      setExpandedOrderId(null);
      writeUrlState({ view, status, q: query, page: 1, limit }, 'replace');
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [limit, query, status, view]);

  async function toggleAttemptHistory(orderId: string): Promise<void> {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }

    setExpandedOrderId(orderId);
    if (Object.hasOwn(attemptHistory, orderId)) return;

    setAttemptHistoryLoading(orderId);
    setAttemptHistoryErrors((current) => ({ ...current, [orderId]: '' }));
    try {
      const history = await getOrderAttempts(orderId);
      setAttemptHistory((current) => ({ ...current, [orderId]: history }));
    } catch (caughtError) {
      setAttemptHistoryErrors((current) => ({ ...current, [orderId]: readError(caughtError) }));
    } finally {
      setAttemptHistoryLoading(null);
    }
  }

  async function retry(): Promise<void> {
    if (!retryOrderId) return;

    const orderId = retryOrderId;
    setRetryingOrderId(orderId);
    setError(null);
    try {
      await retryOrder(orderId);
      setNotice(`Order ${orderId} was queued for retry.`);
      setRetryOrderId(null);
      setExpandedOrderId(null);
      await refresh();
    } catch (caughtError) {
      setError(readError(caughtError));
    } finally {
      setRetryingOrderId(null);
    }
  }

  async function exportDeals(): Promise<void> {
    setExporting(true);
    setError(null);
    try {
      await downloadDealsCsv();
      setNotice('Deal CSV download started.');
    } catch (caughtError) {
      setError(readError(caughtError));
    } finally {
      setExporting(false);
    }
  }

  function selectView(nextView: DashboardView): void {
    writeUrlState({ view: nextView, status, q: search, page: 1, limit }, 'push');
    setView(nextView);
    setPage(1);
    setExpandedOrderId(null);
  }

  function selectStatus(nextStatus: StatusFilter): void {
    writeUrlState({ view, status: nextStatus, q: search, page: 1, limit }, 'push');
    setStatus(nextStatus);
    setPage(1);
    setExpandedOrderId(null);
  }

  function selectPage(nextPage: number): void {
    writeUrlState({ view, status, q: search, page: nextPage, limit }, 'push');
    setPage(nextPage);
    setExpandedOrderId(null);
  }

  function selectLimit(nextLimit: PageLimit): void {
    writeUrlState({ view, status, q: search, page: 1, limit: nextLimit }, 'push');
    setLimit(nextLimit);
    setPage(1);
    setExpandedOrderId(null);
  }

  return {
    stats,
    view,
    ordersPage,
    attemptsPage,
    status,
    query,
    limit,
    expandedOrderId,
    attemptHistory,
    attemptHistoryLoading,
    attemptHistoryErrors,
    loading,
    error,
    notice,
    retryingOrderId,
    retryOrderId,
    exporting,
    refresh,
    exportDeals,
    retry,
    selectView,
    selectStatus,
    setQuery,
    selectPage,
    selectLimit,
    setRetryOrderId,
    toggleAttemptHistory,
  };
}

function readUrlState(): UrlState {
  const parameters = new URLSearchParams(window.location.search);
  const view = parameters.get('view') === 'attempts' ? 'attempts' : 'orders';
  const candidateStatus = parameters.get('status')?.toUpperCase() ?? '';
  const status = statusOptions.some((option) => option.value === candidateStatus)
    ? (candidateStatus as StatusFilter)
    : '';
  const q = (parameters.get('q') ?? '').trim().slice(0, 120);
  const candidatePage = Number(parameters.get('page'));
  const page = Number.isInteger(candidatePage) && candidatePage > 0 ? candidatePage : 1;
  const candidateLimit = Number(parameters.get('limit'));
  const limit = [10, 20, 50].includes(candidateLimit) ? (candidateLimit as PageLimit) : 20;
  return { view, status, q, page, limit };
}

function writeUrlState(state: UrlState, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('view', state.view);
  if (state.status) url.searchParams.set('status', state.status.toLowerCase());
  if (state.q) url.searchParams.set('q', state.q);
  url.searchParams.set('page', String(state.page));
  url.searchParams.set('limit', String(state.limit));
  window.history[`${mode}State`]({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function readError(error: unknown): string {
  return error instanceof DashboardApiError ? error.message : 'The dashboard could not reach the API.';
}
