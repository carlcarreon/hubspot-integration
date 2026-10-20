import {
  JobStatus,
  OrderStatus,
  PrismaClient,
} from '../generated/prisma/client.js';

export type SyncAttemptSummary = {
  id: string;
  orderId: string;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  orderStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  attemptNumber: number;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  nextRetryAt: Date | null;
};

export type SyncStats = {
  successful: number;
  failed: number;
  pending: number;
  processing: number;
};

export type RetriedOrder = {
  orderId: string;
  status: 'PENDING';
  jobStatus: 'PENDING';
};

export interface SyncMonitoringRepository {
  list(status?: OrderStatus): Promise<SyncAttemptSummary[]>;
  stats(): Promise<SyncStats>;
  findAttempt(id: string): Promise<SyncAttemptSummary | null>;
  requeueFailedOrder(orderId: string): Promise<RetriedOrder>;
}

export class SyncAttemptNotFoundError extends Error {
  constructor() {
    super('The requested sync attempt was not found.');
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super('The requested order was not found.');
  }
}

export class OrderCannotBeRetriedError extends Error {
  constructor() {
    super('Only failed orders with a failed sync job can be retried.');
  }
}

const attemptSelect = {
  id: true,
  attemptNumber: true,
  status: true,
  hubspotContactId: true,
  hubspotDealId: true,
  errorMessage: true,
  startedAt: true,
  completedAt: true,
  order: {
    select: {
      orderId: true,
      status: true,
      hubspotContactId: true,
      hubspotDealId: true,
      nextRetryAt: true,
    },
  },
} as const;

type AttemptRecord = {
  id: string;
  attemptNumber: number;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  order: {
    orderId: string;
    status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
    hubspotContactId: string | null;
    hubspotDealId: string | null;
    nextRetryAt: Date | null;
  };
};

export class PrismaSyncMonitoringRepository implements SyncMonitoringRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly manualRetryAttemptAllowance = 8,
  ) {}

  async list(status?: OrderStatus): Promise<SyncAttemptSummary[]> {
    const attempts = await this.database.syncAttempt.findMany({
      where: status ? { order: { status } } : undefined,
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: attemptSelect,
    });

    return attempts.map((attempt) => toSummary(attempt as AttemptRecord));
  }

  async stats(): Promise<SyncStats> {
    const [successful, failed, pending, processing] = await Promise.all([
      this.database.order.count({ where: { status: OrderStatus.SUCCESS } }),
      this.database.order.count({ where: { status: OrderStatus.FAILED } }),
      this.database.order.count({ where: { status: OrderStatus.PENDING } }),
      this.database.order.count({ where: { status: OrderStatus.PROCESSING } }),
    ]);

    return { successful, failed, pending, processing };
  }

  async findAttempt(id: string): Promise<SyncAttemptSummary | null> {
    const attempt = await this.database.syncAttempt.findUnique({
      where: { id },
      select: attemptSelect,
    });
    return attempt ? toSummary(attempt as AttemptRecord) : null;
  }

  async requeueFailedOrder(orderId: string): Promise<RetriedOrder> {
    return this.database.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({
        where: { orderId },
        select: {
          id: true,
          orderId: true,
          status: true,
          syncJob: { select: { id: true, status: true, attempts: true, maxAttempts: true } },
        },
      });
      if (!order) {
        throw new OrderNotFoundError();
      }
      if (order.status !== OrderStatus.FAILED || order.syncJob?.status !== JobStatus.FAILED) {
        throw new OrderCannotBeRetriedError();
      }

      // Attempt numbers remain monotonic because SyncAttempt has a unique
      // (orderId, attemptNumber) audit constraint. An exhausted job gets a
      // fresh bounded allowance instead of resetting attempts back to zero.
      const nextMaxAttempts = order.syncJob.attempts >= order.syncJob.maxAttempts
        ? order.syncJob.attempts + this.manualRetryAttemptAllowance
        : order.syncJob.maxAttempts;

      // The status predicate is the concurrency guard. A second request which
      // observed FAILED waits for the first transaction, then changes zero rows.
      const claimed = await transaction.syncJob.updateMany({
        where: { id: order.syncJob.id, status: JobStatus.FAILED },
        data: {
          status: JobStatus.PENDING,
          availableAt: new Date(),
          processingLeaseUntil: null,
          maxAttempts: nextMaxAttempts,
          lastError: null,
        },
      });
      if (claimed.count !== 1) {
        throw new OrderCannotBeRetriedError();
      }

      // Do not change payload or known HubSpot IDs. Existing SyncAttempt rows
      // remain immutable; the worker creates the next attempt when it claims.
      await transaction.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PENDING,
          nextRetryAt: new Date(),
          processingLeaseUntil: null,
        },
      });

      return { orderId: order.orderId, status: 'PENDING', jobStatus: 'PENDING' };
    });
  }
}

function toSummary(attempt: AttemptRecord): SyncAttemptSummary {
  return {
    id: attempt.id,
    orderId: attempt.order.orderId,
    status: attempt.status,
    orderStatus: attempt.order.status,
    attemptNumber: attempt.attemptNumber,
    hubspotContactId: attempt.hubspotContactId ?? attempt.order.hubspotContactId,
    hubspotDealId: attempt.hubspotDealId ?? attempt.order.hubspotDealId,
    errorMessage: attempt.errorMessage,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    nextRetryAt: attempt.order.nextRetryAt,
  };
}
