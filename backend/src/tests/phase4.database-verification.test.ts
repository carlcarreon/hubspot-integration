import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AttemptStatus, JobStatus, OrderStatus } from '../generated/prisma/client.js';
import { prisma } from '../config/database.js';
import { RetryPolicy } from '../jobs/retry-policy.js';
import { SyncJobWorker } from '../jobs/sync-job-worker.js';
import { PrismaSyncJobRepository } from '../repositories/sync-job.repository.js';
import { HubSpotHttpClient } from '../services/hubspot-client.service.js';
import { HubSpotSyncService } from '../services/hubspot-sync.service.js';

const runVerification = process.env.RUN_PHASE4_DB_VERIFICATION === '1';
const describeVerification = runVerification ? describe : describe.skip;
const createdOrderIds = new Set<string>();

const payload = {
  event: 'order.created',
  created_at: '2026-10-20T00:00:00.000Z',
  customer: {
    email: 'phase4-verification@example.test',
    first_name: 'Phase',
    last_name: 'Verifier',
    phone: '+639171234567',
  },
  items: [{ sku: 'VERIFY-1', name: 'Verification Item', qty: 1, price: 100 }],
  currency: 'PHP',
  total: 100,
} as const;

describeVerification('Phase 4 PostgreSQL verification (mocked HubSpot HTTP)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    const processingJobs = await prisma.syncJob.count({ where: { status: JobStatus.PROCESSING } });
    if (processingJobs > 0) {
      throw new Error(
        'Refusing Phase 4 verification while a job is PROCESSING. Stop local workers and wait for active jobs first.',
      );
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const orderIds = [...createdOrderIds];
    createdOrderIds.clear();
    if (orderIds.length > 0) {
      // The FK cascade removes only this suite's jobs and attempts.
      await prisma.order.deleteMany({ where: { orderId: { in: orderIds } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists a 429 attempt and honors Retry-After when scheduling the retry', async () => {
    const order = await createOrder('429', 3);
    const startedAt = Date.now();
    await processWithResponses([
      hubSpotError(429, 'RATE_LIMITED', 'correlation-429', { 'Retry-After': '5' }),
    ]);

    const state = await stateFor(order.orderId);

    expect(state?.status).toBe(OrderStatus.PENDING);
    expect(state?.syncJob).toMatchObject({ status: JobStatus.PENDING, attempts: 1 });
    expect(state?.syncJob?.availableAt.getTime()).toBeGreaterThanOrEqual(startedAt + 4_900);
    expect(state?.syncAttempts).toHaveLength(1);
    expect(state?.syncAttempts[0]).toMatchObject({
      attemptNumber: 1,
      status: AttemptStatus.FAILED,
      errorMessage: expect.stringContaining('correlation-429'),
    });
    expect(state?.syncAttempts[0]?.completedAt).not.toBeNull();
  });

  it('uses increasing exponential backoff for 500 retries and preserves attempt history', async () => {
    const order = await createOrder('500', 3);
    const firstStartedAt = Date.now();
    await processWithResponses([hubSpotError(500, 'SERVER_ERROR', 'correlation-500-a')]);
    const afterFirst = await stateFor(order.orderId);
    const firstDelay = afterFirst?.syncJob?.availableAt.getTime() ?? 0;

    expect(firstDelay).toBeGreaterThanOrEqual(firstStartedAt + 400);
    await makeAvailable(order.orderId);

    const secondStartedAt = Date.now();
    await processWithResponses([hubSpotError(500, 'SERVER_ERROR', 'correlation-500-b')]);
    const afterSecond = await stateFor(order.orderId);
    const secondDelay = afterSecond?.syncJob?.availableAt.getTime() ?? 0;

    expect(afterSecond?.syncJob).toMatchObject({ status: JobStatus.PENDING, attempts: 2 });
    expect(secondDelay).toBeGreaterThanOrEqual(secondStartedAt + 900);
    expect(afterSecond?.syncAttempts.map((attempt) => attempt.status))
      .toEqual([AttemptStatus.FAILED, AttemptStatus.FAILED]);
  });

  it('schedules a 503 retry and records its sanitized HubSpot correlation ID', async () => {
    const order = await createOrder('503', 3);
    await processWithResponses([hubSpotError(503, 'SERVICE_UNAVAILABLE', 'correlation-503')]);

    const state = await stateFor(order.orderId);

    expect(state?.syncJob).toMatchObject({ status: JobStatus.PENDING, attempts: 1 });
    expect(state?.syncAttempts[0]).toMatchObject({
      status: AttemptStatus.FAILED,
      errorMessage: expect.stringContaining('correlation-503'),
    });
  });

  it('marks a permanent 400 validation failure as FAILED without a retry time', async () => {
    const order = await createOrder('400', 3);
    await processWithResponses([
      hubSpotError(400, 'VALIDATION_ERROR', 'correlation-400', undefined, 'Property does not exist'),
    ]);

    const state = await stateFor(order.orderId);

    expect(state).toMatchObject({ status: OrderStatus.FAILED, nextRetryAt: null });
    expect(state?.syncJob).toMatchObject({ status: JobStatus.FAILED, attempts: 1 });
    expect(state?.syncAttempts[0]).toMatchObject({
      status: AttemptStatus.FAILED,
      errorMessage: expect.stringContaining('VALIDATION_ERROR'),
    });
  });

  it('permanently fails a retryable job after its configured attempt limit', async () => {
    const order = await createOrder('EXHAUSTED', 2);
    await processWithResponses([hubSpotError(503, 'SERVICE_UNAVAILABLE', 'correlation-exhausted-a')]);
    await makeAvailable(order.orderId);
    await processWithResponses([hubSpotError(503, 'SERVICE_UNAVAILABLE', 'correlation-exhausted-b')]);

    const state = await stateFor(order.orderId);

    expect(state).toMatchObject({ status: OrderStatus.FAILED, nextRetryAt: null });
    expect(state?.syncJob).toMatchObject({ status: JobStatus.FAILED, attempts: 2 });
    expect(state?.syncAttempts.map((attempt) => attempt.status))
      .toEqual([AttemptStatus.FAILED, AttemptStatus.FAILED]);
  });

  it('recovers an expired lease, closes the abandoned attempt, and resumes without creating duplicates', async () => {
    const order = await createOrder('LEASE', 3, {
      status: OrderStatus.PROCESSING,
      processingLeaseUntil: new Date(Date.now() - 60_000),
      hubspotContactId: 'contact-existing',
      hubspotDealId: 'deal-existing',
      syncJob: {
        status: JobStatus.PROCESSING,
        attempts: 1,
        processingLeaseUntil: new Date(Date.now() - 60_000),
      },
    });
    await prisma.syncAttempt.create({
      data: { orderId: order.id, attemptNumber: 1, status: AttemptStatus.PROCESSING },
    });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await processWithFetch(fetchImplementation);
    const state = await stateFor(order.orderId);

    expect(state).toMatchObject({
      status: OrderStatus.SUCCESS,
      hubspotContactId: 'contact-existing',
      hubspotDealId: 'deal-existing',
    });
    expect(state?.syncJob).toMatchObject({ status: JobStatus.COMPLETED, attempts: 2 });
    expect(state?.syncAttempts.map((attempt) => attempt.status))
      .toEqual([AttemptStatus.FAILED, AttemptStatus.SUCCESS]);
    expect(state?.syncAttempts[0]?.errorMessage).toContain('worker was restarted or interrupted');
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(fetchImplementation.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.hubapi.com/crm/objects/2026-09/contacts/contact-existing',
      'https://api.hubapi.com/crm/objects/2026-09/deals/deal-existing',
      'https://api.hubapi.com/crm/objects/2026-09/deals/deal-existing/associations/default/contacts/contact-existing',
    ]);
  });
});

async function createOrder(
  scenario: string,
  maxAttempts: number,
  overrides: {
    status?: OrderStatus;
    processingLeaseUntil?: Date;
    hubspotContactId?: string;
    hubspotDealId?: string;
    syncJob?: Partial<{
      status: JobStatus;
      attempts: number;
      processingLeaseUntil: Date;
    }>;
  } = {},
) {
  const orderId = `PHASE4-VERIFY-${scenario}-${randomUUID()}`;
  createdOrderIds.add(orderId);
  return prisma.order.create({
    data: {
      orderId,
      payload: { ...payload, order_id: orderId },
      status: overrides.status,
      processingLeaseUntil: overrides.processingLeaseUntil,
      hubspotContactId: overrides.hubspotContactId,
      hubspotDealId: overrides.hubspotDealId,
      syncJob: {
        create: {
          maxAttempts,
          status: overrides.syncJob?.status,
          attempts: overrides.syncJob?.attempts,
          processingLeaseUntil: overrides.syncJob?.processingLeaseUntil,
        },
      },
    },
  });
}

async function processWithResponses(responses: Response[]): Promise<void> {
  const fetchImplementation = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchImplementation.mockResolvedValueOnce(response);
  }
  await processWithFetch(fetchImplementation);
}

async function processWithFetch(fetchImplementation: typeof fetch): Promise<void> {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const repository = new PrismaSyncJobRepository(prisma);
  const client = new HubSpotHttpClient('phase4-verification-token', fetchImplementation);
  const service = new HubSpotSyncService(client, repository, {
    pipelineId: 'pipeline-verification',
    dealStageId: 'stage-verification',
  });
  const worker = new SyncJobWorker(
    repository,
    service,
    300_000,
    new RetryPolicy(1_000, 10_000, () => 0.5),
  );

  await expect(worker.processNext()).resolves.toBe(true);
}

function hubSpotError(
  status: number,
  category: string,
  correlationId: string,
  headers?: HeadersInit,
  message = 'Mocked HubSpot verification failure',
): Response {
  return Response.json({
    category,
    message,
    correlationId,
    errors: [{ code: category, message }],
  }, { status, headers });
}

async function makeAvailable(orderId: string): Promise<void> {
  await prisma.syncJob.updateMany({
    where: { order: { orderId } },
    data: { availableAt: new Date(Date.now() - 1) },
  });
}

function stateFor(orderId: string) {
  return prisma.order.findUnique({
    where: { orderId },
    include: {
      syncJob: true,
      syncAttempts: { orderBy: { attemptNumber: 'asc' } },
    },
  });
}
