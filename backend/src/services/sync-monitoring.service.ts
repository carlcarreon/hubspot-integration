import type { OrderStatus } from '../generated/prisma/client.js';
import type {
  FailedOrdersPage,
  OrdersPage,
  RetriedOrder,
  SyncAttemptsPage,
  SyncAttemptSummary,
  SyncMonitoringRepository,
  SyncStats,
} from '../repositories/sync-monitoring.repository.js';

export class SyncMonitoringService {
  constructor(private readonly repository: SyncMonitoringRepository) {}

  listAttempts(status: OrderStatus | undefined, search: string, limit: number, page: number): Promise<SyncAttemptsPage> {
    return this.repository.listAttempts(status, search, limit, page);
  }

  stats(): Promise<SyncStats> {
    return this.repository.stats();
  }

  listOrders(status: OrderStatus | undefined, search: string, limit: number, page: number): Promise<OrdersPage> {
    return this.repository.listOrders(status, search, limit, page);
  }

  listFailedOrders(limit: number, offset: number): Promise<FailedOrdersPage> {
    return this.repository.listFailedOrders(limit, offset);
  }

  findAttempt(id: string): Promise<SyncAttemptSummary | null> {
    return this.repository.findAttempt(id);
  }

  findOrderAttempts(orderId: string): Promise<SyncAttemptSummary[] | null> {
    return this.repository.findOrderAttempts(orderId);
  }

  retryFailedOrder(orderId: string): Promise<RetriedOrder> {
    return this.repository.requeueFailedOrder(orderId);
  }
}
