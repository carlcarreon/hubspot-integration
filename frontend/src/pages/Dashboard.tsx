import { DashboardControls } from '../components/dashboard/DashboardControls';
import { LoadingRows } from '../components/dashboard/DashboardFeedback';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { MonitoringTable } from '../components/dashboard/MonitoringTable';
import { PaginationControls } from '../components/dashboard/PaginationControls';
import { RetryDialog } from '../components/dashboard/RetryDialog';
import { useDashboard } from '../hooks/useDashboard';

export function Dashboard() {
  const dashboard = useDashboard();

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <DashboardHeader
          stats={dashboard.stats}
          loading={dashboard.loading}
          exporting={dashboard.exporting}
          onRefresh={() => void dashboard.refresh()}
          onExport={() => void dashboard.exportDeals()}
        />
        {dashboard.notice && (
          <div className="mt-7 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
            {dashboard.notice}
          </div>
        )}
        {dashboard.error && (
          <div className="mt-7 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {dashboard.error}
          </div>
        )}
        <section
          className="mt-7 rounded-2xl border border-slate-200 bg-white shadow-sm"
          aria-labelledby="monitoring-table-title"
        >
          <DashboardControls
            view={dashboard.view}
            status={dashboard.status}
            query={dashboard.query}
            limit={dashboard.limit}
            onViewChange={dashboard.selectView}
            onStatusChange={dashboard.selectStatus}
            onQueryChange={dashboard.setQuery}
            onClearQuery={() => dashboard.setQuery('')}
            onLimitChange={dashboard.selectLimit}
          />
          {dashboard.loading && (
            <LoadingRows label={dashboard.view === 'orders' ? 'Loading orders' : 'Loading sync attempts'} />
          )}
          {!dashboard.loading && !dashboard.error && (
            <MonitoringTable
              view={dashboard.view}
              orders={dashboard.ordersPage.data}
              attempts={dashboard.attemptsPage.data}
              expandedOrderId={dashboard.expandedOrderId}
              attemptHistory={dashboard.attemptHistory}
              attemptHistoryLoading={dashboard.attemptHistoryLoading}
              attemptHistoryErrors={dashboard.attemptHistoryErrors}
              retryingOrderId={dashboard.retryingOrderId}
              onToggleHistory={(orderId) => void dashboard.toggleAttemptHistory(orderId)}
              onRetry={dashboard.setRetryOrderId}
            />
          )}
          {!dashboard.loading && !dashboard.error && (
            <PaginationControls
              pagination={
                dashboard.view === 'orders' ? dashboard.ordersPage.pagination : dashboard.attemptsPage.pagination
              }
              onSelectPage={dashboard.selectPage}
            />
          )}
        </section>
      </div>
      {dashboard.retryOrderId && (
        <RetryDialog
          orderId={dashboard.retryOrderId}
          busy={dashboard.retryingOrderId === dashboard.retryOrderId}
          onCancel={() => dashboard.setRetryOrderId(null)}
          onConfirm={() => void dashboard.retry()}
        />
      )}
    </main>
  );
}
