import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../config/database.js';
import type { Environment } from '../config/env.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';
import { PrismaOrderRepository } from '../repositories/order.repository.js';

const signingSecret = 'integration-test-webhook-secret';
const testEnvironment: Environment = {
  NODE_ENV: 'test',
  API_PORT: 3000,
  DATABASE_URL: process.env.DATABASE_URL!,
  FRONTEND_ORIGIN: 'http://localhost:5173',
  WEBHOOK_SIGNING_SECRET: signingSecret,
  DASHBOARD_API_TOKEN: undefined,
  WORKER_POLL_INTERVAL_MS: 1_000,
  WORKER_LEASE_SECONDS: 300,
  WORKER_MAX_ATTEMPTS: 8,
  WORKER_RETRY_BASE_DELAY_MS: 1_000,
  WORKER_RETRY_MAX_DELAY_MS: 60_000,
};
const app = createApp({
  healthRepository: new PrismaHealthRepository(prisma),
  orderRepository: new PrismaOrderRepository(prisma, testEnvironment.WORKER_MAX_ATTEMPTS),
}, testEnvironment);
const createdOrderIds = new Set<string>();

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(async () => {
  const orderIds = [...createdOrderIds];
  createdOrderIds.clear();
  if (orderIds.length > 0) {
    await prisma.order.deleteMany({ where: { orderId: { in: orderIds } } });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

function createPayload(orderId: string) {
  return {
    event: 'order.created',
    order_id: orderId,
    created_at: '2026-09-20T14:32:00+08:00',
    customer: {
      email: 'webhook-test@example.com',
      first_name: 'Maria',
      last_name: 'Santos',
      phone: '+639171234567',
    },
    items: [{ sku: 'TSH-BLK-M', name: 'Black Tee (M)', qty: 2, price: 450 }],
    currency: 'PHP',
    total: 900,
  };
}

function signatureFor(rawBody: string): string {
  return `sha256=${createHmac('sha256', signingSecret).update(rawBody).digest('hex')}`;
}

function postRaw(rawBody: string, signature?: string) {
  const requestBuilder = request(app)
    .post('/api/webhooks/orders')
    .set('Content-Type', 'application/json');

  if (signature) {
    requestBuilder.set('X-Webhook-Signature', signature);
  }

  return requestBuilder.send(rawBody);
}

describe('POST /api/webhooks/orders', () => {
  it('persists a signed valid order and exactly one durable job', async () => {
    const orderId = `TEST-VALID-${Date.now()}`;
    createdOrderIds.add(orderId);
    const rawBody = JSON.stringify(createPayload(orderId));

    const response = await postRaw(rawBody, signatureFor(rawBody));

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      data: { orderId, status: 'PENDING', duplicate: false },
    });

    const order = await prisma.order.findUnique({
      where: { orderId },
      include: { syncJob: true },
    });
    expect(order?.payload).toEqual(createPayload(orderId));
    expect(order?.syncJob).toMatchObject({ orderId: order?.id, status: 'PENDING', attempts: 0 });
  });

  it('rejects an invalid signature without persisting an order', async () => {
    const orderId = `TEST-INVALID-SIGNATURE-${Date.now()}`;
    const rawBody = JSON.stringify(createPayload(orderId));

    const response = await postRaw(rawBody, 'sha256:incorrect');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    await expect(prisma.order.findUnique({ where: { orderId } })).resolves.toBeNull();
  });

  it('rejects an unsigned request without persisting an order', async () => {
    const orderId = `TEST-UNSIGNED-${Date.now()}`;
    const rawBody = JSON.stringify(createPayload(orderId));

    const response = await postRaw(rawBody);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    await expect(prisma.order.findUnique({ where: { orderId } })).resolves.toBeNull();
  });

  it('rejects a tampered body signed for different bytes', async () => {
    const orderId = `TEST-TAMPERED-${Date.now()}`;
    const rawBody = JSON.stringify(createPayload(orderId));
    const tamperedBody = rawBody.replace('Maria', 'Marian');

    const response = await postRaw(tamperedBody, signatureFor(rawBody));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    await expect(prisma.order.findUnique({ where: { orderId } })).resolves.toBeNull();
  });

  it('rejects a signed body that fails the order.created schema', async () => {
    const orderId = `TEST-INVALID-PAYLOAD-${Date.now()}`;
    const rawBody = JSON.stringify({ ...createPayload(orderId), event: 'order.updated' });

    const response = await postRaw(rawBody, signatureFor(rawBody));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PAYLOAD');
    await expect(prisma.order.findUnique({ where: { orderId } })).resolves.toBeNull();
  });

  it('returns the existing order for duplicate delivery without another job', async () => {
    const orderId = `TEST-DUPLICATE-${Date.now()}`;
    createdOrderIds.add(orderId);
    const rawBody = JSON.stringify(createPayload(orderId));
    const signature = signatureFor(rawBody);

    const [first, second] = await Promise.all([
      postRaw(rawBody, signature),
      postRaw(rawBody, signature),
    ]);

    expect([first.status, second.status]).toEqual([202, 202]);
    expect([first.body.data.duplicate, second.body.data.duplicate].sort()).toEqual([false, true]);
    await expect(prisma.order.count({ where: { orderId } })).resolves.toBe(1);
    await expect(prisma.syncJob.count({ where: { order: { orderId } } })).resolves.toBe(1);
  });
});
