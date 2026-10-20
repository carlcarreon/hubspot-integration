import type { SyncAttempt } from '../../services/dashboard-api';
import { formatDate } from '../../utils/formatDate';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { EmptyState } from './DashboardFeedback';
import { RetryButton } from './RetryButton';
import { RetryStateBadge, StatusBadge } from './StatusBadge';

type SyncAttemptsTableProps = {
  attempts: SyncAttempt[];
  retryingOrderId: string | null;
  onRetry: (orderId: string) => void;
};

export function SyncAttemptsTable({ attempts, retryingOrderId, onRetry }: SyncAttemptsTableProps) {
  if (attempts.length === 0) return <EmptyState message="No real sync attempts match this current-order status yet." />;

  return (
    <Table className="min-w-[1050px] text-left">
      <TableHeader className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
        <TableRow className="hover:bg-transparent">
          <TableHead className="px-5 py-3">Order</TableHead>
          <TableHead className="px-5 py-3">Current / job</TableHead>
          <TableHead className="px-5 py-3">Attempt</TableHead>
          <TableHead className="px-5 py-3">HubSpot IDs</TableHead>
          <TableHead className="px-5 py-3">Error</TableHead>
          <TableHead className="px-5 py-3">Timestamp</TableHead>
          <TableHead className="px-5 py-3">
            <span className="sr-only">Action</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-slate-100">
        {attempts.map((attempt) => (
          <TableRow key={attempt.id} className="align-top text-slate-700 hover:bg-transparent">
            <TableCell className="px-5 py-4 font-semibold text-slate-900">
              {attempt.orderId}
              <div className="mt-1 text-xs font-normal text-slate-500">Attempt {attempt.attemptNumber}</div>
            </TableCell>
            <TableCell className="px-5 py-4">
              <StatusBadge status={attempt.orderStatus} />
              <div className="mt-1 text-xs text-slate-500">Job: {attempt.jobStatus ?? '—'}</div>
            </TableCell>
            <TableCell className="px-5 py-4">
              <StatusBadge status={attempt.status} />
              <RetryStateBadge state={attempt.retryState} />
            </TableCell>
            <TableCell className="px-5 py-4 text-xs text-slate-600">
              <div>Contact: {attempt.hubspotContactId ?? '—'}</div>
              <div className="mt-1">Deal: {attempt.hubspotDealId ?? '—'}</div>
            </TableCell>
            <TableCell
              className={`max-w-xs px-5 py-4 ${attempt.status === 'FAILED' ? 'text-rose-700' : 'text-slate-600'}`}
            >
              {attempt.status === 'FAILED' ? (attempt.errorMessage ?? 'No error recorded.') : 'No error recorded.'}
            </TableCell>
            <TableCell className="px-5 py-4 whitespace-nowrap text-slate-600">
              {formatDate(attempt.completedAt ?? attempt.startedAt)}
            </TableCell>
            <TableCell className="px-5 py-4">
              <RetryButton
                canRetry={attempt.canRetry}
                orderId={attempt.orderId}
                retryingOrderId={retryingOrderId}
                onRetry={onRetry}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
