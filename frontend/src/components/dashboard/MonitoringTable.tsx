import type { OrderSyncStatus, SyncAttempt } from '../../services/dashboard-api';
import { OrdersTable } from './OrdersTable';
import { SyncAttemptsTable } from './SyncAttemptsTable';
import type { AttemptHistory, DashboardView } from './types';

type MonitoringTableProps = {
  view: DashboardView;
  orders: OrderSyncStatus[];
  attempts: SyncAttempt[];
  expandedOrderId: string | null;
  attemptHistory: AttemptHistory;
  attemptHistoryLoading: string | null;
  attemptHistoryErrors: Record<string, string>;
  retryingOrderId: string | null;
  onToggleHistory: (orderId: string) => void;
  onRetry: (orderId: string) => void;
};

export function MonitoringTable({
  view,
  orders,
  attempts,
  expandedOrderId,
  attemptHistory,
  attemptHistoryLoading,
  attemptHistoryErrors,
  retryingOrderId,
  onToggleHistory,
  onRetry,
}: MonitoringTableProps) {
  if (view === 'attempts') {
    return <SyncAttemptsTable attempts={attempts} retryingOrderId={retryingOrderId} onRetry={onRetry} />;
  }

  return (
    <OrdersTable
      orders={orders}
      expandedOrderId={expandedOrderId}
      attemptHistory={attemptHistory}
      attemptHistoryLoading={attemptHistoryLoading}
      attemptHistoryErrors={attemptHistoryErrors}
      retryingOrderId={retryingOrderId}
      onToggleHistory={onToggleHistory}
      onRetry={onRetry}
    />
  );
}
