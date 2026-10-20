import type { OrderSyncStatus, SyncAttempt } from '../../services/dashboard-api';
import { formatDate } from '../../utils/formatDate';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { AttemptHistory } from './AttemptHistory';
import { EmptyState } from './DashboardFeedback';
import { RetryButton } from './RetryButton';
import { StatusBadge } from './StatusBadge';

type OrdersTableProps = {
  orders: OrderSyncStatus[];
  expandedOrderId: string | null;
  attemptHistory: Record<string, SyncAttempt[]>;
  attemptHistoryLoading: string | null;
  attemptHistoryErrors: Record<string, string>;
  retryingOrderId: string | null;
  onToggleHistory: (orderId: string) => void;
  onRetry: (orderId: string) => void;
};

export function OrdersTable({
  orders,
  expandedOrderId,
  attemptHistory,
  attemptHistoryLoading,
  attemptHistoryErrors,
  retryingOrderId,
  onToggleHistory,
  onRetry,
}: OrdersTableProps) {
  if (orders.length === 0) return <EmptyState message="No orders match this status yet." />;

  return (
    <Table className="min-w-[1180px] text-left">
      <TableHeader className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
        <TableRow className="hover:bg-transparent">
          <TableHead className="px-5 py-3">Order</TableHead>
          <TableHead className="px-5 py-3">Current / job</TableHead>
          <TableHead className="px-5 py-3">Latest attempt</TableHead>
          <TableHead className="px-5 py-3">HubSpot IDs</TableHead>
          <TableHead className="px-5 py-3">Last error</TableHead>
          <TableHead className="px-5 py-3">Updated</TableHead>
          <TableHead className="px-5 py-3">Attempts</TableHead>
          <TableHead className="px-5 py-3">
            <span className="sr-only">Action</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-slate-100">
        {orders.map((order) => (
          <OrderRow
            key={order.orderId}
            order={order}
            expanded={expandedOrderId === order.orderId}
            history={attemptHistory[order.orderId]}
            historyLoading={attemptHistoryLoading === order.orderId}
            historyError={attemptHistoryErrors[order.orderId]}
            retryingOrderId={retryingOrderId}
            onToggleHistory={onToggleHistory}
            onRetry={onRetry}
          />
        ))}
      </TableBody>
    </Table>
  );
}

type OrderRowProps = {
  order: OrderSyncStatus;
  expanded: boolean;
  history: SyncAttempt[] | undefined;
  historyLoading: boolean;
  historyError: string | undefined;
  retryingOrderId: string | null;
  onToggleHistory: (orderId: string) => void;
  onRetry: (orderId: string) => void;
};

function OrderRow({
  order,
  expanded,
  history,
  historyLoading,
  historyError,
  retryingOrderId,
  onToggleHistory,
  onRetry,
}: OrderRowProps) {
  return (
    <>
      <TableRow className="align-top text-slate-700 hover:bg-transparent">
        <TableCell className="px-5 py-4 font-semibold text-slate-900">{order.orderId}</TableCell>
        <TableCell className="px-5 py-4">
          <StatusBadge status={order.orderStatus} />
          <div className="mt-1 text-xs text-slate-500">Job: {order.jobStatus ?? '—'}</div>
        </TableCell>
        <TableCell className="px-5 py-4">
          <StatusBadge status={order.latestAttemptStatus} />
        </TableCell>
        <TableCell className="px-5 py-4 text-xs text-slate-600">
          <div>Contact: {order.hubspotContactId ?? '—'}</div>
          <div className="mt-1">Deal: {order.hubspotDealId ?? '—'}</div>
        </TableCell>
        <TableCell className="max-w-xs px-5 py-4 text-rose-700">{order.lastError ?? '—'}</TableCell>
        <TableCell className="px-5 py-4 whitespace-nowrap text-slate-600">{formatDate(order.updatedAt)}</TableCell>
        <TableCell className="px-5 py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onToggleHistory(order.orderId)}
            className="border-indigo-200 bg-indigo-50 text-xs font-bold text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} ${order.attemptCount} ${order.attemptCount === 1 ? 'attempt' : 'attempts'} for ${order.orderId}`}
          >
            <span>
              {order.attemptCount} {order.attemptCount === 1 ? 'attempt' : 'attempts'}
            </span>
            <ChevronIcon expanded={expanded} />
          </Button>
        </TableCell>
        <TableCell className="px-5 py-4">
          <RetryButton
            canRetry={order.canRetry}
            orderId={order.orderId}
            retryingOrderId={retryingOrderId}
            onRetry={onRetry}
          />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-slate-50 hover:bg-slate-50">
          <TableCell colSpan={8} className="px-5 py-4">
            <AttemptHistory history={history} loading={historyLoading} error={historyError} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
    >
      <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
