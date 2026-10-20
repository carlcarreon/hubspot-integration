import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Environment } from '../config/env.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';
import type { OrderRepository } from '../repositories/order.repository.js';
import {
  OrderCannotBeRetriedError,
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

function attempt(id: string, orderId: string, status: SyncAttemptSummary['status'], orderStatus = status): SyncAttemptSummary {
  return {
    id,
    orderId,
    status,
    orderStatus,
    attemptNumber: 1,
    hubspotContactId: 'contact-1',
    hubspotDealId: 'deal-1',
    errorMessage: status === 'FAILED' ? 'A sanitized failure.' : null,
    startedAt: new Date('2026-10-20T12:00:00.000Z'),
    completedAt: new Date('2026-10-20T12:01:00.000Z'),
    nextRetryAt: null,
  };
}

function createRepository(): SyncMonitoringRepository & { retried: number } {
  let retried = false;
  return {
    retried: 0,
    async list() {
      return [attempt('attempt-new', 'ORDER-NEW', 'FAILED'), attempt('attempt-old', 'ORDER-OLD', 'SUCCESS')];
    },
    async stats() {
      return { successful: 9, failed: 1, pending: 2, processing: 3 };
    },
    async findAttempt(id) {
      return id === 'attempt-new' ? attempt(id, 'ORDER-NEW', 'FAILED') : null;
    },
    async requeueFailedOrder(orderId): Promise<RetriedOrder> {
      if (orderId !== 'ORDER-NEW' || retried) {
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
    await request(createDashboardApp()).get('/api/syncs').set('Authorization', 'Bearer wrong').expect(401);
    await request(createDashboardApp(undefined, null)).get('/api/syncs').expect(503).expect({
      error: { code: 'DASHBOARD_AUTH_NOT_CONFIGURED', message: 'Dashboard access is not configured.' },
    });
  });

  it('returns the newest sync history shape, stats, and an attempt detail', async () => {
    const app = createDashboardApp();
    const list = await request(app).get('/api/syncs').set(authorization).expect(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.map((value: { id: string }) => value.id)).toEqual(['attempt-new', 'attempt-old']);
    expect(list.body.data[0]).toMatchObject({ orderId: 'ORDER-NEW', status: 'FAILED', orderStatus: 'FAILED', hubspotDealId: 'deal-1' });

    await request(app).get('/api/syncs/stats').set(authorization).expect(200).expect({
      data: { successful: 9, failed: 1, pending: 2, processing: 3 },
    });
    await request(app).get('/api/syncs/attempt-new').set(authorization).expect(200).expect((response) => {
      expect(response.body.data.orderId).toBe('ORDER-NEW');
    });
    await request(app).get('/api/syncs/missing').set(authorization).expect(404);
  });

  it('queues a failed order once and rejects a simultaneous duplicate retry', async () => {
    const app = createDashboardApp();
    const [first, second] = await Promise.all([
      request(app).post('/api/orders/ORDER-NEW/retry').set(authorization),
      request(app).post('/api/orders/ORDER-NEW/retry').set(authorization),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    expect([first.body.data, second.body.data].find(Boolean)).toMatchObject({ orderId: 'ORDER-NEW', status: 'PENDING' });
  });
});
