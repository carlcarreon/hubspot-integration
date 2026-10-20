import type { SyncAttempt } from '../../services/dashboard-api';
import { Badge } from '../ui/badge';

export function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;

  const colors: Record<string, string> = {
    SUCCESS: 'bg-emerald-100 text-emerald-800',
    COMPLETED: 'bg-emerald-100 text-emerald-800',
    FAILED: 'bg-rose-100 text-rose-800',
    PENDING: 'bg-amber-100 text-amber-800',
    PROCESSING: 'bg-indigo-100 text-indigo-800',
  };

  return (
    <Badge
      variant={status === 'FAILED' ? 'destructive' : 'secondary'}
      className={`border-0 font-bold ${colors[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </Badge>
  );
}

export function RetryStateBadge({ state }: { state: SyncAttempt['retryState'] }) {
  if (!state) return null;

  const labels = { SCHEDULED: 'Retry scheduled', RETRIED: 'Retried later', TERMINAL: 'Terminal failure' } as const;
  const colors = {
    SCHEDULED: 'bg-amber-100 text-amber-800',
    RETRIED: 'bg-indigo-100 text-indigo-800',
    TERMINAL: 'bg-rose-100 text-rose-800',
  } as const;

  return (
    <Badge
      variant={state === 'TERMINAL' ? 'destructive' : 'secondary'}
      className={`border-0 font-bold ${colors[state]}`}
    >
      {labels[state]}
    </Badge>
  );
}
