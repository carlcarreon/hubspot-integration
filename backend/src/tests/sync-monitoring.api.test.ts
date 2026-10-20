import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Environment } from '../config/env.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';
import type { OrderRepository } from '../repositories/order.repository.js';
import {
  OrderCannotBeRetriedError,
  type FailedOrdersPage,
  type OrdersPage,
  type OrderSyncSummary,
  type RetriedOrder,
  type SyncAttemptSummary,
  type SyncMonitoringRepository,
} from '../repositories/sync-monitoring.repository.js';

const environment: Environment = {
  NODE_ENV: 'test',
  API_PORT: 3000,
  DATABASE_URL: 'postgresql://hubspot:hubspot@localhost:5432/hubspot_order_sync',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  WEBHOOK_SIGNING_SECRET: 'test-webhook-signing-secret',
  DASHBOARD_API_TOKEN: 'dashboard-test-token',
  HUBSPOT_ACCESS_TOKEN: undefined,
  HUBSPOT_PIPELINE_ID: undefined,
  HUBSPOT_DEAL_STAGE_ID: undefined,
  PYTHON_EXECUTABLE: 'python3.11',
  EXPORT_TIMEOUT_MS: 90_000,
  EXPORT_MAX_CONCURRENT: 1,
  WORKER_POLL_INTERVAL_MS: 1_000,
  WORKER_LEASE_SECONDS: 300,
  WORKER_MAX_ATTEMPTS: 8,
  WORKER_RETRY_BASE_DELAY_MS: 1_000,
  WORKER_RETRY_MAX_DELAY_MS: 60_000,
};

const unusedOrderRepository: OrderRepository = {
  async createOrFindWithInitialJob() {
    throw new Error('Not used by dashboard tests.');
  },
};

function attempt(id: string, orderId: string, status: SyncAttemptSummary['status'], orderStatus = status, retryState: SyncAttemptSummary['retryState'] = null): SyncAttemptSummary {
  return {
    id,
    orderId,
    status,
    orderStatus,
    jobStatus: orderStatus === 'FAILED' ? 'FAILED' : 'COMPLETED',
    canRetry: orderStatus === 'FAILED',
    attemptNumber: 1,
    hubspotContactId: 'contact-1',
    hubspotDealId: 'deal-1',
    errorMessage: status === 'FAILED' ? 'HubSpot request failed with status 429. RATE_LIMITED; correlationId=correlation-429; Too many requests.' : null,
    httpStatusCode: status === 'FAILED' ? 429 : null,
    hubspotErrorCategory: status === 'FAILED' ? 'RATE_LIMITED' : null,
    hubspotCorrelationId: status === 'FAILED' ? 'correlation-429' : null,
    retryState,
    retryScheduledFor: retryState === 'SCHEDULED' ? new Date('2026-10-20T12:05:00.000Z') : null,
    startedAt: new Date('2026-10-20T12:00:00.000Z'),
    completedAt: new Date('2026-10-20T12:01:00.000Z'),
    nextRetryAt: null,
  };
}

function createRepository(): SyncMonitoringRepository & { retried: number; listedStatus?: string; listedOrderStatus?: string } {
  let retried = false;
  let listedStatus: string | undefined;
  let listedOrderStatus: string | undefined;
  const orderRows: OrderSyncSummary[] = [
    {
      orderId: 'ORDER-NEW', orderStatus: 'FAILED', jobStatus: 'FAILED', latestAttemptStatus: 'FAILED', canRetry: true,
      hubspotContactId: 'contact-1', hubspotDealId: 'deal-1', lastError: 'A sanitized failure.',
      updatedAt: new Date('2026-10-20T12:01:00.000Z'), attemptCount: 1,
    },
    {
      orderId: 'ORDER-LEGACY', orderStatus: 'FAILED', jobStatus: 'FAILED', latestAttemptStatus: null, canRetry: true,
      hubspotContactId: 'contact-legacy', hubspotDealId: null, lastError: 'A legacy saved job failure.',
      updatedAt: new Date('2026-10-20T11:01:00.000Z'), attemptCount: 0,
    },
    {
      orderId: 'ORDER-OLD', orderStatus: 'SUCCESS', jobStatus: 'COMPLETED', latestAttemptStatus: 'SUCCESS', canRetry: false,
      hubspotContactId: 'contact-2', hubspotDealId: 'deal-2', lastError: null,
      updatedAt: new Date('2026-10-20T10:01:00.000Z'), attemptCount: 1,
    },
  ];
  return {
    retried: 0,
    get listedStatus() {
      return listedStatus;
    },
    async listAttempts(status, _search, limit, page) {
      listedStatus = status;
      const data = [attempt('attempt-new', 'ORDER-NEW', 'FAILED'), attempt('attempt-old', 'ORDER-OLD', 'SUCCESS')];
      return { data: data.slice((page - 1) * limit, page * limit), pagination: { page, limit, totalItems: data.length, totalPages: 1 } };
    },
    async stats() {
      return { successful: 9, failed: 1, pending: 2, processing: 3 };
    },
    get listedOrderStatus() {
      return listedOrderStatus;
    },
    async listOrders(status, search, limit, page): Promise<OrdersPage> {
      listedOrderStatus = status;
      const statusMatched = status ? orderRows.filter((order) => order.orderStatus === status) : orderRows;
      const matching = search ? statusMatched.filter((order) => order.orderId.includes(search)) : statusMatched;
      const data = matching.slice((page - 1) * limit, page * limit);
      return { data, pagination: { page, limit, totalItems: matching.length, totalPages: Math.ceil(matching.length / limit) } };
    },
    async listFailedOrders(limit, offset): Promise<FailedOrdersPage> {
      const all = [
        {
          orderId: 'ORDER-NEW', status: 'FAILED' as const, jobStatus: 'FAILED' as const, canRetry: true,
          hubspotContactId: 'contact-1', hubspotDealId: 'deal-1', failureReason: 'A sanitized failure.',
          updatedAt: new Date('2026-10-20T12:01:00.000Z'), hasAttemptHistory: true,
        },
        {
          orderId: 'ORDER-LEGACY', status: 'FAILED' as const, jobStatus: 'FAILED' as const, canRetry: true,
          hubspotContactId: 'contact-legacy', hubspotDealId: null, failureReason: 'A legacy saved job failure.',
          updatedAt: new Date('2026-10-20T11:01:00.000Z'), hasAttemptHistory: false,
        },
      ];
      const data = all.slice(offset, offset + limit);
      return { data, pagination: { limit, offset, total: all.length, hasMore: offset + data.length < all.length } };
    },
    async findAttempt(id) {
      return id === 'attempt-new' ? attempt(id, 'ORDER-NEW', 'FAILED') : null;
    },
    async findOrderAttempts(orderId) {
      if (orderId === 'ORDER-LEGACY') return [];
      if (orderId === 'ORDER-NEW') return [
        attempt('attempt-new', orderId, 'FAILED', 'SUCCESS', 'RETRIED'),
        attempt('attempt-success', orderId, 'SUCCESS', 'SUCCESS'),
      ];
      return null;
    },
    async requeueFailedOrder(orderId): Promise<RetriedOrder> {
      if (!['ORDER-NEW', 'ORDER-LEGACY'].includes(orderId) || retried) {
        throw new OrderCannotBeRetriedError();
      }
      retried = true;
      this.retried += 1;
      return { orderId, status: 'PENDING', jobStatus: 'PENDING' };
    },
  };
}

function createDashboardApp(repository = createRepository(), token: string | null | undefined = environment.DASHBOARD_API_TOKEN) {
  const healthRepository = new PrismaHealthRepository({ $queryRawUnsafe: async () => undefined });
  return createApp({ healthRepository, orderRepository: unusedOrderRepository, syncMonitoringRepository: repository }, {
    ...environment,
    DASHBOARD_API_TOKEN: token ?? undefined,
  });
}

const authorization = { Authorization: `Bearer ${environment.DASHBOARD_API_TOKEN}` };

describe('dashboard monitoring API', () => {
  it('requires a valid dashboard bearer token and reports an unconfigured safeguard', async () => {
    await request(createDashboardApp()).get('/api/syncs').expect(401).expect({
      error: { code: 'UNAUTHORIZED', message: 'Dashboard authentication is required.' },
    });
    await request(createDashboardApp()).get('/api/orders/failed').expect(401);
    await request(createDashboardApp()).get('/api/orders').expect(401);
    await request(createDashboardApp()).get('/api/syncs').set('Authorization', 'Bearer wrong').expect(401);
    await request(createDashboardApp(undefined, null)).get('/api/syncs').expect(503).expect({
      error: { code: 'DASHBOARD_AUTH_NOT_CONFIGURED', message: 'Dashboard access is not configured.' },
    });
  });

  it('returns the newest sync history shape, stats, and an attempt detail', async () => {
    const repository = createRepository();
    const app = createDashboardApp(repository);
    const list = await request(app).get('/api/syncs').set(authorization).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.map((value: { id: string }) => value.id)).toEqual(['attempt-new', 'attempt-old']);
    expect(list.body.data[0]).toMatchObject({ orderId: 'ORDER-NEW', status: 'FAILED', orderStatus: 'FAILED', hubspotDealId: 'deal-1' });
    await request(app).get('/api/syncs?orderStatus=FAILED').set(authorization).expect(200);
    expect(repository.listedStatus).toBe('FAILED');

    await request(app).get('/api/syncs/stats').set(authorization).expect(200).expect({
      data: { successful: 9, failed: 1, pending: 2, processing: 3 },
    });
    await request(app).get('/api/syncs/attempt-new').set(authorization).expect(200).expect((response) => {
      expect(response.body.data).toMatchObject({
        orderId: 'ORDER-NEW', httpStatusCode: 429, hubspotErrorCategory: 'RATE_LIMITED',
        hubspotCorrelationId: 'correlation-429', errorMessage: expect.stringContaining('Too many requests'),
      });
    });
    await request(app).get('/api/syncs/missing').set(authorization).expect(404);

    const orders = await request(app).get('/api/orders?status=FAILED&limit=10&page=1&q=LEGACY').set(authorization).expect(200);
    expect(orders.body).toMatchObject({
      data: [{ orderId: 'ORDER-LEGACY', latestAttemptStatus: null, attemptCount: 0, canRetry: true }],
      pagination: { limit: 10, page: 1, totalItems: 1, totalPages: 1 },
    });
    expect(repository.listedOrderStatus).toBe('FAILED');
    await request(app).get('/api/orders?status=INVALID').set(authorization).expect(400);
    await request(app).get('/api/orders/ORDER-LEGACY/attempts').set(authorization).expect(200).expect({ data: [] });
    await request(app).get('/api/orders/ORDER-NEW/attempts').set(authorization).expect(200).expect((response) => {
      expect(response.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'FAILED', retryState: 'RETRIED', completedAt: expect.any(String) }),
        expect.objectContaining({ status: 'SUCCESS', errorMessage: null, retryState: null }),
      ]));
    });
    await request(app).get('/api/orders/missing/attempts').set(authorization).expect(404);

    const failedOrders = await request(app).get('/api/orders/failed?limit=1&offset=1').set(authorization).expect(200);
    expect(failedOrders.body).toMatchObject({
      data: [{ orderId: 'ORDER-LEGACY', hasAttemptHistory: false, jobStatus: 'FAILED' }],
      pagination: { limit: 1, offset: 1, total: 2, hasMore: false },
    });
    await request(app).get('/api/orders/failed?limit=51').set(authorization).expect(400);
  });

  it('queues a failed order once and rejects a simultaneous duplicate retry', async () => {
    const app = createDashboardApp();
    const [first, second] = await Promise.all([
      request(app).post('/api/orders/ORDER-NEW/retry').set(authorization),
      request(app).post('/api/orders/ORDER-NEW/retry').set(authorization),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    expect([first.body.data, second.body.data].find(Boolean)).toMatchObject({ orderId: 'ORDER-NEW', status: 'PENDING' });
    await request(createDashboardApp()).post('/api/orders/ORDER-LEGACY/retry').set(authorization).expect(202).expect({
      data: { orderId: 'ORDER-LEGACY', status: 'PENDING', jobStatus: 'PENDING' },
    });
  });
});
