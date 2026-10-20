import { useCallback, useEffect, useState } from 'react';
import {
  DashboardApiError,
  getStats,
  getSyncs,
  retryOrder,
  type DashboardStats,
  type AttemptStatus,
  type OrderStatus,
  type SyncAttempt,
} from './services/dashboard-api';

const statusOptions: Array<{ label: string; value: OrderStatus | '' }> = [
  { label: 'All current order statuses', value: '' },
  { label: 'Successful', value: 'SUCCESS' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Processing', value: 'PROCESSING' },
];

export function App() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [attempts, setAttempts] = useState<SyncAttempt[]>([]);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingOrderId, setRetryingOrderId] = useState<string | null>(null);
  const [confirmAttempt, setConfirmAttempt] = useState<SyncAttempt | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStats, nextAttempts] = await Promise.all([getStats(), getSyncs(status || undefined)]);
      setStats(nextStats);
      setAttempts(nextAttempts);
    } catch (caughtError) {
      setError(readError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function retry(): Promise<void> {
    if (!confirmAttempt) {
      return;
    }
    const orderId = confirmAttempt.orderId;
    setRetryingOrderId(orderId);
    setError(null);
    try {
      await retryOrder(orderId);
      setNotice(`Order ${orderId} was queued for retry.`);
      setConfirmAttempt(null);
      await refresh();
    } catch (caughtError) {
      setError(readError(caughtError));
    } finally {
      setRetryingOrderId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Operations</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">HubSpot sync monitor</h1>
            <p className="mt-2 text-slate-600">Live PostgreSQL-backed synchronization history and recovery controls.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Order status summary">
          <SummaryCard label="Successful" value={stats?.successful} color="emerald" />
          <SummaryCard label="Failed" value={stats?.failed} color="rose" />
          <SummaryCard label="Pending" value={stats?.pending} color="amber" />
          <SummaryCard label="Processing" value={stats?.processing} color="indigo" />
        </section>

        <section className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-bold text-slate-900">Recent sync attempts</h2>
              <p className="mt-1 text-sm text-slate-500">The newest 50 attempts. Summary cards count current order status.</p>
            </div>
            <label className="text-sm font-medium text-slate-700" htmlFor="status-filter">
              <span className="mr-2">Filter</span>
              <select id="status-filter" value={status} onChange={(event) => setStatus(event.target.value as OrderStatus | '')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800">
                {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          {notice && <div className="m-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{notice}</div>}
          {error && <div className="m-5 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>}
          {loading && <LoadingRows />}
          {!loading && !error && attempts.length === 0 && <div className="px-5 py-16 text-center text-slate-500">No sync attempts match this filter yet.</div>}
          {!loading && attempts.length > 0 && <AttemptTable attempts={attempts} retryingOrderId={retryingOrderId} onRetry={setConfirmAttempt} />}
        </section>
      </div>
      {confirmAttempt && <RetryDialog attempt={confirmAttempt} busy={retryingOrderId === confirmAttempt.orderId} onCancel={() => setConfirmAttempt(null)} onConfirm={() => void retry()} />}
    </main>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number | undefined; color: 'emerald' | 'rose' | 'amber' | 'indigo' }) {
  const colors = { emerald: 'text-emerald-700 bg-emerald-50', rose: 'text-rose-700 bg-rose-50', amber: 'text-amber-700 bg-amber-50', indigo: 'text-indigo-700 bg-indigo-50' };
  return <article className={`rounded-2xl p-5 ${colors[color]}`}><p className="text-sm font-semibold">{label}</p><p className="mt-3 text-3xl font-bold">{value ?? '—'}</p><p className="mt-1 text-xs opacity-80">Current orders</p></article>;
}

function AttemptTable({ attempts, retryingOrderId, onRetry }: { attempts: SyncAttempt[]; retryingOrderId: string | null; onRetry: (attempt: SyncAttempt) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Order</th><th className="px-5 py-3">Attempt status</th><th className="px-5 py-3">HubSpot IDs</th><th className="px-5 py-3">Time</th><th className="px-5 py-3">Error</th><th className="px-5 py-3"><span className="sr-only">Action</span></th></tr></thead><tbody className="divide-y divide-slate-100">{attempts.map((attempt) => { const retryable = attempt.orderStatus === 'FAILED'; return <tr key={attempt.id} className="align-top text-slate-700"><td className="px-5 py-4 font-semibold text-slate-900">{attempt.orderId}<div className="mt-1 text-xs font-normal text-slate-500">Attempt {attempt.attemptNumber} · Current order: {attempt.orderStatus}</div></td><td className="px-5 py-4"><StatusBadge status={attempt.status} /></td><td className="px-5 py-4 text-xs text-slate-600"><div>Contact: {attempt.hubspotContactId ?? '—'}</div><div className="mt-1">Deal: {attempt.hubspotDealId ?? '—'}</div></td><td className="px-5 py-4 whitespace-nowrap text-slate-600">{formatDate(attempt.completedAt ?? attempt.startedAt)}</td><td className="max-w-xs px-5 py-4 text-rose-700">{attempt.errorMessage ?? '—'}</td><td className="px-5 py-4"><button disabled={!retryable || retryingOrderId === attempt.orderId} onClick={() => onRetry(attempt)} className="rounded-md border border-indigo-200 px-3 py-1.5 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400">{retryingOrderId === attempt.orderId ? 'Queueing…' : 'Retry'}</button></td></tr>; })}</tbody></table></div>;
}

function StatusBadge({ status }: { status: AttemptStatus }) {
  const colors: Record<AttemptStatus, string> = { SUCCESS: 'bg-emerald-100 text-emerald-800', FAILED: 'bg-rose-100 text-rose-800', PROCESSING: 'bg-indigo-100 text-indigo-800' };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${colors[status]}`}>{status}</span>;
}

function LoadingRows() { return <div className="space-y-3 p-5" aria-label="Loading sync attempts">{[1, 2, 3, 4].map((row) => <div key={row} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}</div>; }

function RetryDialog({ attempt, busy, onCancel, onConfirm }: { attempt: SyncAttempt; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="retry-title"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="retry-title" className="text-lg font-bold text-slate-950">Retry {attempt.orderId}?</h2><p className="mt-2 text-sm leading-6 text-slate-600">This queues the failed order for the existing durable worker. Its prior attempts and known HubSpot IDs are preserved.</p><div className="mt-6 flex justify-end gap-3"><button onClick={onCancel} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button><button onClick={onConfirm} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Queueing…' : 'Retry order'}</button></div></div></div>;
}

function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function readError(error: unknown): string { return error instanceof DashboardApiError ? error.message : 'The dashboard could not reach the API.'; }
