import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Environment } from '../config/env.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';
import type { OrderRepository } from '../repositories/order.repository.js';

const environment: Environment = {
  NODE_ENV: 'test',
  API_PORT: 3000,
  DATABASE_URL: 'postgresql://hubspot:hubspot@localhost:5432/hubspot_order_sync',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  WEBHOOK_SIGNING_SECRET: 'test-webhook-signing-secret',
  WORKER_POLL_INTERVAL_MS: 1_000,
  WORKER_LEASE_SECONDS: 300,
};

const unusedOrderRepository: OrderRepository = {
  async createOrFindWithInitialJob() {
    throw new Error('The health endpoint must not access order persistence.');
  },
};

function createTestApp(checkDatabase: () => Promise<void>) {
  const healthRepository = new PrismaHealthRepository({
    $queryRawUnsafe: async () => checkDatabase(),
  });
  return createApp({ healthRepository, orderRepository: unusedOrderRepository }, environment);
}

describe('GET /api/health', () => {
  it('reports readiness when PostgreSQL is available', async () => {
    const response = await request(createTestApp(async () => undefined)).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('reports degraded readiness when PostgreSQL is unavailable', async () => {
    const response = await request(createTestApp(async () => {
      throw new Error('database unavailable');
    })).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'degraded', database: 'down' });
  });
});
