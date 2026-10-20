import type { DashboardStats } from '../../services/dashboard-api';
import { Button } from '../ui/button';

type SummaryCardColor = 'emerald' | 'rose' | 'amber' | 'indigo';

type DashboardHeaderProps = {
  stats: DashboardStats | null;
  loading: boolean;
  exporting: boolean;
  onRefresh: () => void;
  onExport: () => void;
};

export function DashboardHeader({ stats, loading, exporting, onRefresh, onExport }: DashboardHeaderProps) {
  return (
    <>
      <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-600">Operations</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">HubSpot sync monitor</h1>
          <p className="mt-2 text-slate-600">
            Live PostgreSQL-backed order state, sync history, and recovery controls.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onRefresh}
            disabled={loading}
            className="h-10 border-slate-300 bg-white px-4 text-slate-800 hover:bg-slate-100"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            onClick={onExport}
            disabled={exporting}
            className="h-10 bg-indigo-600 px-4 text-white hover:bg-indigo-700"
          >
            {exporting ? 'Exporting…' : 'Export Deals (Last 7 Days)'}
          </Button>
        </div>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Order status summary">
        <SummaryCard label="Successful" value={stats?.successful} color="emerald" />
        <SummaryCard label="Failed" value={stats?.failed} color="rose" />
        <SummaryCard label="Pending" value={stats?.pending} color="amber" />
        <SummaryCard label="Processing" value={stats?.processing} color="indigo" />
      </section>
    </>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number | undefined; color: SummaryCardColor }) {
  const colors: Record<SummaryCardColor, string> = {
    emerald: 'text-emerald-700 bg-emerald-50',
    rose: 'text-rose-700 bg-rose-50',
    amber: 'text-amber-700 bg-amber-50',
    indigo: 'text-indigo-700 bg-indigo-50',
  };

  return (
    <article className={`rounded-2xl p-5 ${colors[color]}`}>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-3 text-3xl font-bold">{value ?? '—'}</p>
      <p className="mt-1 text-xs opacity-80">Current orders</p>
    </article>
  );
}
