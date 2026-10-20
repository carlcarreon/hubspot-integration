import type { OrderStatus } from '../generated/prisma/client.js';
import type {
  RetriedOrder,
  SyncAttemptSummary,
  SyncMonitoringRepository,
  SyncStats,
} from '../repositories/sync-monitoring.repository.js';

export class SyncMonitoringService {
  constructor(private readonly repository: SyncMonitoringRepository) {}

  list(status?: OrderStatus): Promise<SyncAttemptSummary[]> {
    return this.repository.list(status);
  }

  stats(): Promise<SyncStats> {
    return this.repository.stats();
  }

  findAttempt(id: string): Promise<SyncAttemptSummary | null> {
    return this.repository.findAttempt(id);
  }

  retryFailedOrder(orderId: string): Promise<RetriedOrder> {
    return this.repository.requeueFailedOrder(orderId);
  }
}
