import {
  AttemptStatus,
  JobStatus,
  OrderStatus,
  type Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';

export type SyncAttemptSummary = {
  id: string;
  orderId: string;
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  orderStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  jobStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
  canRetry: boolean;
  attemptNumber: number;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  errorMessage: string | null;
  httpStatusCode: number | null;
  hubspotErrorCategory: string | null;
  hubspotCorrelationId: string | null;
  retryState: 'SCHEDULED' | 'RETRIED' | 'TERMINAL' | null;
  retryScheduledFor: Date | null;
  startedAt: Date;
  completedAt: Date | null;
  nextRetryAt: Date | null;
};

export type OrderSyncSummary = {
  orderId: string;
  orderStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  jobStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
  latestAttemptStatus: 'PROCESSING' | 'SUCCESS' | 'FAILED' | null;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  lastError: string | null;
  updatedAt: Date;
  attemptCount: number;
  canRetry: boolean;
};

export type OrdersPage = {
  data: OrderSyncSummary[];
  pagination: Pagination;
};

export type SyncAttemptsPage = {
  data: SyncAttemptSummary[];
  pagination: Pagination;
};

export type Pagination = {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
};

export type SyncStats = {
  successful: number;
  failed: number;
  pending: number;
  processing: number;
};

/**
 * A current failed order is intentionally distinct from a SyncAttempt. Older
 * orders can have a durable terminal job but no immutable attempt rows, and a
 * failed order can also be outside the 50-row attempt-history window.
 */
export type FailedOrderSummary = {
  orderId: string;
  status: 'FAILED';
  jobStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
  canRetry: boolean;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  failureReason: string | null;
  updatedAt: Date;
  hasAttemptHistory: boolean;
};

export type FailedOrdersPage = {
  data: FailedOrderSummary[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
};

export type RetriedOrder = {
  orderId: string;
  status: 'PENDING';
  jobStatus: 'PENDING';
};

export interface SyncMonitoringRepository {
  listAttempts(status: OrderStatus | undefined, search: string, limit: number, page: number): Promise<SyncAttemptsPage>;
  stats(): Promise<SyncStats>;
  listOrders(status: OrderStatus | undefined, search: string, limit: number, page: number): Promise<OrdersPage>;
  listFailedOrders(limit: number, offset: number): Promise<FailedOrdersPage>;
  findAttempt(id: string): Promise<SyncAttemptSummary | null>;
  findOrderAttempts(orderId: string): Promise<SyncAttemptSummary[] | null>;
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
      syncJob: { select: { status: true, attempts: true } },
    },
  },
} as const;

const orderSyncSelect = {
  id: true,
  orderId: true,
  status: true,
  hubspotContactId: true,
  hubspotDealId: true,
  updatedAt: true,
  syncJob: {
    select: {
      status: true,
      lastError: true,
    },
  },
  syncAttempts: {
    orderBy: { startedAt: 'desc' },
    take: 1,
    select: {
      status: true,
      errorMessage: true,
      hubspotContactId: true,
      hubspotDealId: true,
    },
  },
  _count: { select: { syncAttempts: true } },
} as const;

const failedOrderSelect = {
  id: true,
  orderId: true,
  status: true,
  hubspotContactId: true,
  hubspotDealId: true,
  updatedAt: true,
  syncJob: {
    select: {
      status: true,
      lastError: true,
    },
  },
  syncAttempts: {
    where: { status: AttemptStatus.FAILED },
    orderBy: { completedAt: 'desc' },
    take: 1,
    select: { errorMessage: true },
  },
  _count: { select: { syncAttempts: true } },
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
    syncJob: {
      status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
      attempts: number;
    } | null;
  };
};

type OrderSyncRecord = {
  id: string;
  orderId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  updatedAt: Date;
  syncJob: {
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    lastError: string | null;
  } | null;
  syncAttempts: Array<{
    status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
    errorMessage: string | null;
    hubspotContactId: string | null;
    hubspotDealId: string | null;
  }>;
  _count: { syncAttempts: number };
};

type FailedOrderRecord = {
  id: string;
  orderId: string;
  status: 'FAILED';
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  updatedAt: Date;
  syncJob: {
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    lastError: string | null;
  } | null;
  syncAttempts: Array<{ errorMessage: string | null }>;
  _count: { syncAttempts: number };
};

export class PrismaSyncMonitoringRepository implements SyncMonitoringRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly manualRetryAttemptAllowance = 8,
  ) {}

  async listAttempts(status: OrderStatus | undefined, search: string, limit: number, page: number): Promise<SyncAttemptsPage> {
    const orderWhere = buildOrderWhere(status, search);
    const where = orderWhere ? { order: orderWhere } : undefined;
    const count = await this.database.syncAttempt.count({ where });
    // The dashboard's audit view remains intentionally bounded to the newest
    // 50 real attempts, while still allowing 10/20/50-row server pages.
    const totalItems = Math.min(count, 50);
    const totalPages = Math.ceil(totalItems / limit);
    const effectivePage = normalizePage(page, totalPages);
    const attempts = await this.database.syncAttempt.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (effectivePage - 1) * limit,
      take: Math.min(limit, Math.max(0, totalItems - (effectivePage - 1) * limit)),
      select: attemptSelect,
    });
    return {
      data: attempts.map((attempt) => toSummary(attempt as AttemptRecord)),
      pagination: { page: effectivePage, limit, totalItems, totalPages },
    };
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

  async listOrders(status: OrderStatus | undefined, search: string, limit: number, page: number): Promise<OrdersPage> {
    const where = buildOrderWhere(status, search);
    const totalItems = await this.database.order.count({ where });
    const totalPages = Math.ceil(totalItems / limit);
    const effectivePage = normalizePage(page, totalPages);
    const orders = await this.database.order.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (effectivePage - 1) * limit,
      take: limit,
      select: orderSyncSelect,
    });

    return {
      data: orders.map((order) => toOrderSyncSummary(order as OrderSyncRecord)),
      pagination: { page: effectivePage, limit, totalItems, totalPages },
    };
  }

  async listFailedOrders(limit: number, offset: number): Promise<FailedOrdersPage> {
    // Filter from the authoritative current Order state, rather than from the
    // audit trail. This deliberately includes legacy failed orders that have
    // no SyncAttempt record and keeps the total aligned with stats().failed.
    const where = { status: OrderStatus.FAILED };
    const [orders, total] = await Promise.all([
      this.database.order.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        select: failedOrderSelect,
      }),
      this.database.order.count({ where }),
    ]);

    return {
      data: orders.map((order) => toFailedOrderSummary(order as FailedOrderRecord)),
      pagination: { limit, offset, total, hasMore: offset + orders.length < total },
    };
  }


  async findAttempt(id: string): Promise<SyncAttemptSummary | null> {
    const attempt = await this.database.syncAttempt.findUnique({
      where: { id },
      select: attemptSelect,
    });
    return attempt ? toSummary(attempt as AttemptRecord) : null;
  }

  async findOrderAttempts(orderId: string): Promise<SyncAttemptSummary[] | null> {
    const order = await this.database.order.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (!order) {
      return null;
    }
    const attempts = await this.database.syncAttempt.findMany({
      where: { orderId: order.id },
      orderBy: { attemptNumber: 'desc' },
      select: attemptSelect,
    });
    return attempts.map((attempt) => toSummary(attempt as AttemptRecord));
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
  const jobStatus = attempt.order.syncJob?.status ?? null;
  const errorMessage = sanitizeStoredError(attempt.errorMessage);
  const diagnostics = parseStoredHubSpotDiagnostics(errorMessage);
  const retryState = getRetryState(attempt);
  return {
    id: attempt.id,
    orderId: attempt.order.orderId,
    status: attempt.status,
    orderStatus: attempt.order.status,
    jobStatus,
    canRetry: attempt.order.status === OrderStatus.FAILED && jobStatus === JobStatus.FAILED,
    attemptNumber: attempt.attemptNumber,
    hubspotContactId: attempt.hubspotContactId ?? attempt.order.hubspotContactId,
    hubspotDealId: attempt.hubspotDealId ?? attempt.order.hubspotDealId,
    errorMessage,
    httpStatusCode: diagnostics.httpStatusCode,
    hubspotErrorCategory: diagnostics.hubspotErrorCategory,
    hubspotCorrelationId: diagnostics.hubspotCorrelationId,
    retryState,
    retryScheduledFor: retryState === 'SCHEDULED' ? attempt.order.nextRetryAt : null,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    nextRetryAt: attempt.order.nextRetryAt,
  };
}

function getRetryState(attempt: AttemptRecord): SyncAttemptSummary['retryState'] {
  if (attempt.status !== AttemptStatus.FAILED) {
    return null;
  }
  if (attempt.order.syncJob?.status === JobStatus.PENDING && attempt.order.nextRetryAt) {
    return 'SCHEDULED';
  }
  if ((attempt.order.syncJob?.attempts ?? 0) > attempt.attemptNumber) {
    return 'RETRIED';
  }
  if (attempt.order.status === OrderStatus.FAILED && attempt.order.syncJob?.status === JobStatus.FAILED) {
    return 'TERMINAL';
  }
  return null;
}

function parseStoredHubSpotDiagnostics(errorMessage: string | null): Pick<
  SyncAttemptSummary,
  'httpStatusCode' | 'hubspotErrorCategory' | 'hubspotCorrelationId'
> {
  if (!errorMessage) {
    return { httpStatusCode: null, hubspotErrorCategory: null, hubspotCorrelationId: null };
  }
  const httpStatusCode = Number(/^HubSpot request failed with status (\d{3})\./.exec(errorMessage)?.[1]) || null;
  // HubSpot's sanitized formatter writes the category before correlationId and
  // individual error codes. Only recognize documented category-shaped values;
  // a generic stored error remains a generic error rather than guessed data.
  const hubspotErrorCategory = /^HubSpot request failed with status \d{3}\.\s*((?:[A-Z]+_)*ERROR|RATE_LIMITED)(?:;|$)/
    .exec(errorMessage)?.[1] ?? null;
  const hubspotCorrelationId = /(?:^|;\s*)correlationId=([^;\s]+)/.exec(errorMessage)?.[1] ?? null;
  return { httpStatusCode, hubspotErrorCategory, hubspotCorrelationId };
}

function sanitizeStoredError(message: string | null): string | null {
  if (!message) {
    return null;
  }
  return message
    .replace(/[\r\n]+/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 1_000);
}

function toOrderSyncSummary(order: OrderSyncRecord): OrderSyncSummary {
  const latestAttempt = order.syncAttempts[0];
  const jobStatus = order.syncJob?.status ?? null;
  return {
    orderId: order.orderId,
    orderStatus: order.status,
    jobStatus,
    latestAttemptStatus: latestAttempt?.status ?? null,
    hubspotContactId: order.hubspotContactId ?? latestAttempt?.hubspotContactId ?? null,
    hubspotDealId: order.hubspotDealId ?? latestAttempt?.hubspotDealId ?? null,
    lastError: order.syncJob?.lastError ?? latestAttempt?.errorMessage ?? null,
    updatedAt: order.updatedAt,
    attemptCount: order._count.syncAttempts,
    canRetry: order.status === OrderStatus.FAILED && jobStatus === JobStatus.FAILED,
  };
}

function toFailedOrderSummary(order: FailedOrderRecord): FailedOrderSummary {
  const jobStatus = order.syncJob?.status ?? null;
  return {
    orderId: order.orderId,
    status: 'FAILED',
    jobStatus,
    // The retry service applies the same status predicate transactionally;
    // this flag only controls the dashboard affordance and is never trusted.
    canRetry: jobStatus === JobStatus.FAILED,
    hubspotContactId: order.hubspotContactId,
    hubspotDealId: order.hubspotDealId,
    failureReason: order.syncJob?.lastError ?? order.syncAttempts[0]?.errorMessage ?? null,
    updatedAt: order.updatedAt,
    hasAttemptHistory: order._count.syncAttempts > 0,
  };
}

function buildOrderWhere(status: OrderStatus | undefined, search: string): Prisma.OrderWhereInput | undefined {
  const filters: Prisma.OrderWhereInput[] = [];
  if (status) {
    filters.push({ status });
  }
  if (search) {
    filters.push({
      OR: [
        { orderId: { contains: search, mode: 'insensitive' } },
        { hubspotContactId: { contains: search, mode: 'insensitive' } },
        { hubspotDealId: { contains: search, mode: 'insensitive' } },
        { payload: { path: ['customer', 'email'], string_contains: search } },
      ],
    });
  }
  if (filters.length === 0) {
    return undefined;
  }
  return filters.length === 1 ? filters[0] : { AND: filters };
}

function normalizePage(page: number, totalPages: number): number {
  if (totalPages === 0) {
    return 1;
  }
  return Math.min(Math.max(page, 1), totalPages);
}
