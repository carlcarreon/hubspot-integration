import type { SyncAttempt } from '../../services/dashboard-api';
import { formatDate } from '../../utils/formatDate';
import { RetryStateBadge, StatusBadge } from './StatusBadge';

type AttemptHistoryProps = {
  history: SyncAttempt[] | undefined;
  loading: boolean;
  error: string | undefined;
};

export function AttemptHistory({ history, loading, error }: AttemptHistoryProps) {
  if (loading) return <p className="text-sm text-slate-500">Loading recorded attempt history…</p>;
  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!history || history.length === 0) {
    return <p className="text-sm text-slate-500">No recorded sync attempts for this order.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-slate-700">Recorded sync attempt history</p>
      <div className="space-y-2">
        {history.map((attempt) => (
          <AttemptHistoryCard key={attempt.id} attempt={attempt} />
        ))}
      </div>
    </div>
  );
}

function AttemptHistoryCard({ attempt }: { attempt: SyncAttempt }) {
  const failed = attempt.status === 'FAILED';

  return (
    <article
      className={`rounded-lg border px-3 py-3 text-xs ${failed ? 'border-rose-200 bg-rose-50/50' : 'border-slate-200 bg-white'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900">Attempt {attempt.attemptNumber}</span>
        <StatusBadge status={attempt.status} />
        <RetryStateBadge state={attempt.retryState} />
      </div>
      <dl className="mt-3 grid gap-x-5 gap-y-2 text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
        <AttemptField label="Started" value={formatDate(attempt.startedAt)} />
        <AttemptField
          label="Completed"
          value={attempt.completedAt ? formatDate(attempt.completedAt) : 'Not completed'}
        />
        <AttemptField label="HubSpot Contact ID" value={attempt.hubspotContactId ?? '—'} />
        <AttemptField label="HubSpot Deal ID" value={attempt.hubspotDealId ?? '—'} />
        {attempt.httpStatusCode !== null && <AttemptField label="HTTP status" value={String(attempt.httpStatusCode)} />}
        {attempt.hubspotErrorCategory && <AttemptField label="HubSpot category" value={attempt.hubspotErrorCategory} />}
        {attempt.hubspotCorrelationId && <AttemptField label="Correlation ID" value={attempt.hubspotCorrelationId} />}
        {attempt.retryState === 'SCHEDULED' && (
          <AttemptField
            label="Next retry"
            value={attempt.retryScheduledFor ? formatDate(attempt.retryScheduledFor) : 'Scheduled'}
          />
        )}
      </dl>
      <div
        className={`mt-3 rounded-md px-2.5 py-2 leading-5 ${failed ? 'bg-rose-100/70 text-rose-900' : 'bg-slate-50 text-slate-600'}`}
      >
        <span className="font-semibold">{failed ? 'Stored error: ' : ''}</span>
        {failed ? (attempt.errorMessage ?? 'No error recorded.') : 'No error recorded.'}
      </div>
    </article>
  );
}

function AttemptField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
    </div>
  );
}
