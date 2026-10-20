import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DashboardApiError,
  downloadDealsCsv,
  getOrderAttempts,
  getOrders,
  getStats,
  getSyncs,
  retryOrder,
  type DashboardStats,
  type OrderStatus,
  type OrderSyncStatus,
  type OrdersPage,
  type Pagination,
  type SyncAttempt,
  type SyncAttemptsPage,
} from './services/dashboard-api';
import { pageRange } from './pagination';

type DashboardView = 'orders' | 'attempts';

const statusOptions: Array<{ label: string; value: OrderStatus | '' }> = [
  { label: 'All current statuses', value: '' },
  { label: 'Successful', value: 'SUCCESS' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Processing', value: 'PROCESSING' },
];

const emptyPagination: Pagination = { page: 1, limit: 20, totalItems: 0, totalPages: 0 };
const emptyPage: OrdersPage = { data: [], pagination: emptyPagination };
const emptyAttemptsPage: SyncAttemptsPage = { data: [], pagination: emptyPagination };
type UrlState = { view: DashboardView; status: OrderStatus | ''; q: string; page: number; limit: 10 | 20 | 50 };

function readUrlState(): UrlState {
  const parameters = new URLSearchParams(window.location.search);
  const view = parameters.get('view') === 'attempts' ? 'attempts' : 'orders';
  const candidateStatus = parameters.get('status')?.toUpperCase() ?? '';
  const status = statusOptions.some((option) => option.value === candidateStatus) ? candidateStatus as OrderStatus | '' : '';
  const q = (parameters.get('q') ?? '').trim().slice(0, 120);
  const candidatePage = Number(parameters.get('page'));
  const page = Number.isInteger(candidatePage) && candidatePage > 0 ? candidatePage : 1;
  const candidateLimit = Number(parameters.get('limit'));
  const limit = [10, 20, 50].includes(candidateLimit) ? candidateLimit as 10 | 20 | 50 : 20;
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

export function App() {
  const initialUrlState = readUrlState();
  const skipSearchDebounce = useRef(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [view, setView] = useState<DashboardView>(initialUrlState.view);
  const [ordersPage, setOrdersPage] = useState<OrdersPage>(emptyPage);
  const [attemptsPage, setAttemptsPage] = useState<SyncAttemptsPage>(emptyAttemptsPage);
  const [status, setStatus] = useState<OrderStatus | ''>(initialUrlState.status);
  const [query, setQuery] = useState(initialUrlState.q);
  const [search, setSearch] = useState(initialUrlState.q);
  const [page, setPage] = useState(initialUrlState.page);
  const [limit, setLimit] = useState<10 | 20 | 50>(initialUrlState.limit);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [attemptHistory, setAttemptHistory] = useState<Record<string, SyncAttempt[]>>({});
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
        const [resolvedStats, nextOrders] = await Promise.all([nextStats, getOrders(status || undefined, search, limit, page)]);
        setStats(resolvedStats);
        setOrdersPage(nextOrders);
        if (nextOrders.pagination.page !== page) {
          setPage(nextOrders.pagination.page);
          writeUrlState({ view, status, q: search, page: nextOrders.pagination.page, limit }, 'replace');
        }
      } else {
        const [resolvedStats, nextAttempts] = await Promise.all([nextStats, getSyncs(status || undefined, search, limit, page)]);
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

  useEffect(() => { void refresh(); }, [refresh]);

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

  function selectStatus(nextStatus: OrderStatus | ''): void {
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

  function selectLimit(nextLimit: 10 | 20 | 50): void {
    writeUrlState({ view, status, q: search, page: 1, limit: nextLimit }, 'push');
    setLimit(nextLimit);
    setPage(1);
    setExpandedOrderId(null);
  }

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-7xl">
    <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Operations</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">HubSpot sync monitor</h1><p className="mt-2 text-slate-600">Live PostgreSQL-backed order state, sync history, and recovery controls.</p></div><div className="flex gap-2"><button onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button><button onClick={() => void exportDeals()} disabled={exporting} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{exporting ? 'Exporting…' : 'Export Deals (Last 7 Days)'}</button></div></header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Order status summary"><SummaryCard label="Successful" value={stats?.successful} color="emerald" /><SummaryCard label="Failed" value={stats?.failed} color="rose" /><SummaryCard label="Pending" value={stats?.pending} color="amber" /><SummaryCard label="Processing" value={stats?.processing} color="indigo" /></section>
    {notice && <div className="mt-7 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{notice}</div>}
    {error && <div className="mt-7 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>}
    <section className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="monitoring-table-title"><div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between"><div><h2 id="monitoring-table-title" className="font-bold text-slate-900">Orders &amp; Sync Status</h2><p className="mt-1 text-sm text-slate-500">Current orders include legacy failures without attempt rows. The Attempts view is the newest 50 real audit records.</p></div><div className="flex flex-wrap gap-3"><label className="text-sm font-medium text-slate-700" htmlFor="status-filter"><span className="mr-2">Current status</span><select id="status-filter" value={status} onChange={(event) => selectStatus(event.target.value as OrderStatus | '')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800">{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-sm font-medium text-slate-700" htmlFor="page-limit"><span className="mr-2">Rows</span><select id="page-limit" value={limit} onChange={(event) => selectLimit(Number(event.target.value) as 10 | 20 | 50)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label></div></div><div className="border-b border-slate-200 px-5 py-3"><label className="block text-sm font-medium text-slate-700" htmlFor="orders-search">Search orders, email, or HubSpot ID</label><div className="mt-1 flex max-w-xl gap-2"><input id="orders-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order ID, customer email, Contact ID, or Deal ID" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />{query && <button onClick={() => setQuery('')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Clear</button>}</div></div><div className="flex border-b border-slate-200 px-5" role="tablist" aria-label="Monitoring data view"><Tab active={view === 'orders'} onClick={() => selectView('orders')} label="Orders" /><Tab active={view === 'attempts'} onClick={() => selectView('attempts')} label="Attempts (Latest 50)" /></div>
      {loading && <LoadingRows label={view === 'orders' ? 'Loading orders' : 'Loading sync attempts'} />}
      {!loading && !error && <MonitoringTable view={view} orders={ordersPage.data} attempts={attemptsPage.data} expandedOrderId={expandedOrderId} attemptHistory={attemptHistory} attemptHistoryLoading={attemptHistoryLoading} attemptHistoryErrors={attemptHistoryErrors} retryingOrderId={retryingOrderId} onToggleHistory={(orderId) => void toggleAttemptHistory(orderId)} onRetry={setRetryOrderId} />}
      {!loading && !error && <Pagination pagination={view === 'orders' ? ordersPage.pagination : attemptsPage.pagination} onSelectPage={selectPage} />}
    </section>
  </div>{retryOrderId && <RetryDialog orderId={retryOrderId} busy={retryingOrderId === retryOrderId} onCancel={() => setRetryOrderId(null)} onConfirm={() => void retry()} />}</main>;
}

function SummaryCard({ label, value, color }: { label: string; value: number | undefined; color: 'emerald' | 'rose' | 'amber' | 'indigo' }) { const colors = { emerald: 'text-emerald-700 bg-emerald-50', rose: 'text-rose-700 bg-rose-50', amber: 'text-amber-700 bg-amber-50', indigo: 'text-indigo-700 bg-indigo-50' }; return <article className={`rounded-2xl p-5 ${colors[color]}`}><p className="text-sm font-semibold">{label}</p><p className="mt-3 text-3xl font-bold">{value ?? '—'}</p><p className="mt-1 text-xs opacity-80">Current orders</p></article>; }
function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) { return <button role="tab" aria-selected={active} onClick={onClick} className={`border-b-2 px-4 py-3 text-sm font-semibold ${active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>; }

function MonitoringTable({ view, orders, attempts, expandedOrderId, attemptHistory, attemptHistoryLoading, attemptHistoryErrors, retryingOrderId, onToggleHistory, onRetry }: { view: DashboardView; orders: OrderSyncStatus[]; attempts: SyncAttempt[]; expandedOrderId: string | null; attemptHistory: Record<string, SyncAttempt[]>; attemptHistoryLoading: string | null; attemptHistoryErrors: Record<string, string>; retryingOrderId: string | null; onToggleHistory: (orderId: string) => void; onRetry: (orderId: string) => void }) {
  if (view === 'attempts') {
    if (attempts.length === 0) return <EmptyState message="No real sync attempts match this current-order status yet." />;
    return <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Order</th><th className="px-5 py-3">Current / job</th><th className="px-5 py-3">Attempt</th><th className="px-5 py-3">HubSpot IDs</th><th className="px-5 py-3">Error</th><th className="px-5 py-3">Timestamp</th><th className="px-5 py-3"><span className="sr-only">Action</span></th></tr></thead><tbody className="divide-y divide-slate-100">{attempts.map((attempt) => <tr key={attempt.id} className="align-top text-slate-700"><td className="px-5 py-4 font-semibold text-slate-900">{attempt.orderId}<div className="mt-1 text-xs font-normal text-slate-500">Attempt {attempt.attemptNumber}</div></td><td className="px-5 py-4"><StatusBadge status={attempt.orderStatus} /><div className="mt-1 text-xs text-slate-500">Job: {attempt.jobStatus ?? '—'}</div></td><td className="px-5 py-4"><StatusBadge status={attempt.status} /><RetryStateBadge state={attempt.retryState} /></td><td className="px-5 py-4 text-xs text-slate-600"><div>Contact: {attempt.hubspotContactId ?? '—'}</div><div className="mt-1">Deal: {attempt.hubspotDealId ?? '—'}</div></td><td className={`max-w-xs px-5 py-4 ${attempt.status === 'FAILED' ? 'text-rose-700' : 'text-slate-600'}`}>{attempt.status === 'FAILED' ? attempt.errorMessage ?? 'No error recorded.' : 'No error recorded.'}</td><td className="px-5 py-4 whitespace-nowrap text-slate-600">{formatDate(attempt.completedAt ?? attempt.startedAt)}</td><td className="px-5 py-4"><RetryButton canRetry={attempt.canRetry} orderId={attempt.orderId} retryingOrderId={retryingOrderId} onRetry={onRetry} /></td></tr>)}</tbody></table></div>;
  }
  if (orders.length === 0) return <EmptyState message="No orders match this status yet." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Order</th><th className="px-5 py-3">Current / job</th><th className="px-5 py-3">Latest attempt</th><th className="px-5 py-3">HubSpot IDs</th><th className="px-5 py-3">Last error</th><th className="px-5 py-3">Updated</th><th className="px-5 py-3">Attempts</th><th className="px-5 py-3"><span className="sr-only">Action</span></th></tr></thead><tbody className="divide-y divide-slate-100">{orders.map((order) => <OrderRow key={order.orderId} order={order} expanded={expandedOrderId === order.orderId} history={attemptHistory[order.orderId]} historyLoading={attemptHistoryLoading === order.orderId} historyError={attemptHistoryErrors[order.orderId]} retryingOrderId={retryingOrderId} onToggleHistory={onToggleHistory} onRetry={onRetry} />)}</tbody></table></div>;
}

function OrderRow({ order, expanded, history, historyLoading, historyError, retryingOrderId, onToggleHistory, onRetry }: { order: OrderSyncStatus; expanded: boolean; history: SyncAttempt[] | undefined; historyLoading: boolean; historyError: string | undefined; retryingOrderId: string | null; onToggleHistory: (orderId: string) => void; onRetry: (orderId: string) => void }) { return <><tr className="align-top text-slate-700"><td className="px-5 py-4 font-semibold text-slate-900">{order.orderId}</td><td className="px-5 py-4"><StatusBadge status={order.orderStatus} /><div className="mt-1 text-xs text-slate-500">Job: {order.jobStatus ?? '—'}</div></td><td className="px-5 py-4"><StatusBadge status={order.latestAttemptStatus} /></td><td className="px-5 py-4 text-xs text-slate-600"><div>Contact: {order.hubspotContactId ?? '—'}</div><div className="mt-1">Deal: {order.hubspotDealId ?? '—'}</div></td><td className="max-w-xs px-5 py-4 text-rose-700">{order.lastError ?? '—'}</td><td className="px-5 py-4 whitespace-nowrap text-slate-600">{formatDate(order.updatedAt)}</td><td className="px-5 py-4"><button onClick={() => onToggleHistory(order.orderId)} className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-bold text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} ${order.attemptCount} ${order.attemptCount === 1 ? 'attempt' : 'attempts'} for ${order.orderId}`}><span>{order.attemptCount} {order.attemptCount === 1 ? 'attempt' : 'attempts'}</span><ChevronIcon expanded={expanded} /></button></td><td className="px-5 py-4"><RetryButton canRetry={order.canRetry} orderId={order.orderId} retryingOrderId={retryingOrderId} onRetry={onRetry} /></td></tr>{expanded && <tr className="bg-slate-50"><td colSpan={8} className="px-5 py-4"><AttemptHistory history={history} loading={historyLoading} error={historyError} /></td></tr>}</>; }

function ChevronIcon({ expanded }: { expanded: boolean }) { return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}><path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function AttemptHistory({ history, loading, error }: { history: SyncAttempt[] | undefined; loading: boolean; error: string | undefined }) {
  if (loading) return <p className="text-sm text-slate-500">Loading recorded attempt history…</p>;
  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!history || history.length === 0) return <p className="text-sm text-slate-500">No recorded sync attempts for this order.</p>;
  return <div><p className="mb-3 text-sm font-semibold text-slate-700">Recorded sync attempt history</p><div className="space-y-2">{history.map((attempt) => <AttemptHistoryCard key={attempt.id} attempt={attempt} />)}</div></div>;
}

function AttemptHistoryCard({ attempt }: { attempt: SyncAttempt }) {
  const failed = attempt.status === 'FAILED';
  return <article className={`rounded-lg border px-3 py-3 text-xs ${failed ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'}`}>
    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">Attempt {attempt.attemptNumber}</span><StatusBadge status={attempt.status} /><RetryStateBadge state={attempt.retryState} /></div>
    <dl className="mt-3 grid gap-x-5 gap-y-2 text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
      <AttemptField label="Started" value={formatDate(attempt.startedAt)} />
      <AttemptField label="Completed" value={attempt.completedAt ? formatDate(attempt.completedAt) : 'Not completed'} />
      <AttemptField label="HubSpot Contact ID" value={attempt.hubspotContactId ?? '—'} />
      <AttemptField label="HubSpot Deal ID" value={attempt.hubspotDealId ?? '—'} />
      {attempt.httpStatusCode !== null && <AttemptField label="HTTP status" value={String(attempt.httpStatusCode)} />}
      {attempt.hubspotErrorCategory && <AttemptField label="HubSpot category" value={attempt.hubspotErrorCategory} />}
      {attempt.hubspotCorrelationId && <AttemptField label="Correlation ID" value={attempt.hubspotCorrelationId} />}
      {attempt.retryState === 'SCHEDULED' && <AttemptField label="Next retry" value={attempt.retryScheduledFor ? formatDate(attempt.retryScheduledFor) : 'Scheduled'} />}
    </dl>
    <div className={`mt-3 rounded-md px-2.5 py-2 leading-5 ${failed ? 'bg-rose-100/70 text-rose-900' : 'bg-slate-50 text-slate-600'}`}><span className="font-semibold">{failed ? 'Stored error: ' : ''}</span>{failed ? attempt.errorMessage ?? 'No error recorded.' : 'No error recorded.'}</div>
  </article>;
}

function AttemptField({ label, value }: { label: string; value: string }) { return <div><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-0.5 break-words text-slate-800">{value}</dd></div>; }
function RetryStateBadge({ state }: { state: SyncAttempt['retryState'] }) { if (!state) return null; const labels = { SCHEDULED: 'Retry scheduled', RETRIED: 'Retried later', TERMINAL: 'Terminal failure' } as const; const colors = { SCHEDULED: 'bg-amber-100 text-amber-800', RETRIED: 'bg-indigo-100 text-indigo-800', TERMINAL: 'bg-rose-100 text-rose-800' } as const; return <span className={`rounded-full px-2 py-1 text-xs font-bold ${colors[state]}`}>{labels[state]}</span>; }
function RetryButton({ canRetry, orderId, retryingOrderId, onRetry }: { canRetry: boolean; orderId: string; retryingOrderId: string | null; onRetry: (orderId: string) => void }) { return <button disabled={!canRetry || retryingOrderId === orderId} onClick={() => onRetry(orderId)} className="rounded-md border border-indigo-200 px-3 py-1.5 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">{retryingOrderId === orderId ? 'Queueing…' : 'Retry'}</button>; }
function Pagination({ pagination, onSelectPage }: { pagination: Pagination; onSelectPage: (page: number) => void }) {
  const first = pagination.totalItems === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const last = Math.min(pagination.page * pagination.limit, pagination.totalItems);
  const cannotGoPrevious = pagination.page === 1 || pagination.totalPages === 0;
  const cannotGoNext = pagination.page === pagination.totalPages || pagination.totalPages === 0;
  return <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between"><span>Showing {first}–{last} of {pagination.totalItems} records</span><nav className="flex items-center gap-1" aria-label="Pagination"><button onClick={() => onSelectPage(pagination.page - 1)} disabled={cannotGoPrevious} aria-label="Previous page" title="Previous page" className="rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50">&lt;</button><PageNumbers items={pageRange(pagination.totalPages, pagination.page)} currentPage={pagination.page} onSelectPage={onSelectPage} className="hidden sm:flex" /><PageNumbers items={pageRange(pagination.totalPages, pagination.page, 1, 0)} currentPage={pagination.page} onSelectPage={onSelectPage} className="flex sm:hidden" /><button onClick={() => onSelectPage(pagination.page + 1)} disabled={cannotGoNext} aria-label="Next page" title="Next page" className="rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50">&gt;</button></nav></div>;
}
function PageNumbers({ items, currentPage, onSelectPage, className }: { items: ReturnType<typeof pageRange>; currentPage: number; onSelectPage: (page: number) => void; className: string }) { return <div className={`items-center gap-1 ${className}`}>{items.map((item, index) => item === 'ellipsis' ? <span key={`ellipsis-${index}`} className="px-1">…</span> : <button key={item} onClick={() => onSelectPage(item)} aria-current={item === currentPage ? 'page' : undefined} className={`rounded-md px-2 py-1.5 font-semibold ${item === currentPage ? 'bg-indigo-600 text-white' : 'border border-slate-300 hover:bg-slate-50'}`}>{item}</button>)}</div>; }
function EmptyState({ message }: { message: string }) { return <div className="px-5 py-16 text-center text-slate-500">{message}</div>; }
function StatusBadge({ status }: { status: string | null }) { if (!status) return <span className="text-slate-400">—</span>; const colors: Record<string, string> = { SUCCESS: 'bg-emerald-100 text-emerald-800', COMPLETED: 'bg-emerald-100 text-emerald-800', FAILED: 'bg-rose-100 text-rose-800', PENDING: 'bg-amber-100 text-amber-800', PROCESSING: 'bg-indigo-100 text-indigo-800' }; return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}>{status}</span>; }
function LoadingRows({ label }: { label: string }) { return <div className="space-y-3 p-5" aria-label={label}>{[1, 2, 3, 4].map((row) => <div key={row} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>; }
function RetryDialog({ orderId, busy, onCancel, onConfirm }: { orderId: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) { return <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="retry-title"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="retry-title" className="text-lg font-bold text-slate-950">Retry {orderId}?</h2><p className="mt-2 text-sm leading-6 text-slate-600">This queues the failed order for the existing durable worker. Its prior attempts and known HubSpot IDs are preserved.</p><div className="mt-6 flex justify-end gap-3"><button onClick={onCancel} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button><button onClick={onConfirm} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Queueing…' : 'Retry order'}</button></div></div></div>; }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function readError(error: unknown): string { return error instanceof DashboardApiError ? error.message : 'The dashboard could not reach the API.'; }
