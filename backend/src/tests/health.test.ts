import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Environment } from '../config/env.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';

const environment: Environment = {
  NODE_ENV: 'test',
  API_PORT: 3000,
  DATABASE_URL: 'postgresql://hubspot:hubspot@localhost:5432/hubspot_order_sync',
  FRONTEND_ORIGIN: 'http://localhost:5173',
};

function createTestApp(checkDatabase: () => Promise<void>) {
  const healthRepository = new PrismaHealthRepository({
    $queryRawUnsafe: async () => checkDatabase(),
  });
  return createApp({ healthRepository }, environment);
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
