import { AttemptStatus, JobStatus, OrderStatus, PrismaClient } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { PrismaSyncMonitoringRepository } from '../repositories/sync-monitoring.repository.js';

describe('PrismaSyncMonitoringRepository manual retry', () => {
  it('returns sanitized stored diagnostics and retry outcome without inventing history', async () => {
    const retryAt = new Date('2026-10-20T12:05:00.000Z');
    const database = {
      order: { findUnique: async () => ({ id: 'order-db-id' }) },
      syncAttempt: {
        findMany: async () => [{
          id: 'attempt-1', attemptNumber: 1, status: AttemptStatus.FAILED,
          hubspotContactId: null, hubspotDealId: 'deal-partial',
          errorMessage: 'HubSpot request failed with status 429. RATE_LIMITED; correlationId=corr-429; Bearer secret-token customer@example.com',
          startedAt: new Date('2026-10-20T12:00:00.000Z'), completedAt: new Date('2026-10-20T12:01:00.000Z'),
          order: {
            orderId: 'ORDER-RETRY', status: OrderStatus.PENDING, hubspotContactId: 'contact-partial', hubspotDealId: 'deal-partial',
            nextRetryAt: retryAt, syncJob: { status: JobStatus.PENDING, attempts: 1 },
          },
        }],
      },
    } as unknown as PrismaClient;
    const repository = new PrismaSyncMonitoringRepository(database);

    await expect(repository.findOrderAttempts('ORDER-RETRY')).resolves.toEqual([expect.objectContaining({
      status: AttemptStatus.FAILED, retryState: 'SCHEDULED', retryScheduledFor: retryAt,
      httpStatusCode: 429, hubspotErrorCategory: 'RATE_LIMITED', hubspotCorrelationId: 'corr-429',
      hubspotContactId: 'contact-partial', hubspotDealId: 'deal-partial',
      errorMessage: expect.stringContaining('Bearer [redacted] [redacted-email]'),
    })]);
  });

  it('preserves HubSpot IDs and history-safe attempt numbers when requeuing an exhausted job', async () => {
    let jobUpdate: Record<string, unknown> | undefined;
    let orderUpdate: Record<string, unknown> | undefined;
    const transaction = {
      order: {
        findUnique: async () => ({
          id: 'order-db-id', orderId: 'ORDER-FAILED', status: OrderStatus.FAILED,
          syncJob: { id: 'job-id', status: JobStatus.FAILED, attempts: 8, maxAttempts: 8 },
        }),
        update: async (args: { data: Record<string, unknown> }) => { orderUpdate = args.data; return {}; },
      },
      syncJob: {
        updateMany: async (args: { data: Record<string, unknown> }) => { jobUpdate = args.data; return { count: 1 }; },
      },
    };
    const database = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) => callback(transaction),
    } as unknown as PrismaClient;
    const repository = new PrismaSyncMonitoringRepository(database, 8);

    await expect(repository.requeueFailedOrder('ORDER-FAILED')).resolves.toEqual({
      orderId: 'ORDER-FAILED', status: 'PENDING', jobStatus: 'PENDING',
    });
    expect(jobUpdate).toMatchObject({
      status: JobStatus.PENDING,
      maxAttempts: 16,
      processingLeaseUntil: null,
      lastError: null,
    });
    expect(jobUpdate).not.toHaveProperty('attempts');
    expect(orderUpdate).toMatchObject({ status: OrderStatus.PENDING, processingLeaseUntil: null });
    expect(orderUpdate).not.toHaveProperty('hubspotContactId');
    expect(orderUpdate).not.toHaveProperty('hubspotDealId');
  });

  it('lists current failed orders directly from orders, including legacy rows without attempt history', async () => {
    let findManyArguments: Record<string, unknown> | undefined;
    const database = {
      order: {
        findMany: async (arguments_: Record<string, unknown>) => {
          findManyArguments = arguments_;
          return [{
            id: 'legacy-id', orderId: 'ORDER-LEGACY', status: OrderStatus.FAILED,
            hubspotContactId: 'contact-legacy', hubspotDealId: null,
            updatedAt: new Date('2026-10-20T12:00:00.000Z'),
            syncJob: { status: JobStatus.FAILED, lastError: 'Saved job failure.' },
            syncAttempts: [], _count: { syncAttempts: 0 },
          }, {
            id: 'recorded-id', orderId: 'ORDER-RECORDED', status: OrderStatus.FAILED,
            hubspotContactId: 'contact-recorded', hubspotDealId: 'deal-recorded',
            updatedAt: new Date('2026-10-20T11:00:00.000Z'),
            syncJob: { status: JobStatus.FAILED, lastError: null },
            syncAttempts: [{ errorMessage: 'Attempt failure.' }], _count: { syncAttempts: 1 },
          }];
        },
        count: async () => 2,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaSyncMonitoringRepository(database);

    await expect(repository.listFailedOrders(20, 0)).resolves.toEqual({
      data: [
        expect.objectContaining({ orderId: 'ORDER-LEGACY', hasAttemptHistory: false, canRetry: true, failureReason: 'Saved job failure.' }),
        expect.objectContaining({ orderId: 'ORDER-RECORDED', hasAttemptHistory: true, hubspotDealId: 'deal-recorded', failureReason: 'Attempt failure.' }),
      ],
      pagination: { limit: 20, offset: 0, total: 2, hasMore: false },
    });
    expect(findManyArguments).toMatchObject({
      where: { status: OrderStatus.FAILED }, skip: 0, take: 20,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('returns a status-filtered order page with the latest attempt summary but no fabricated legacy attempt', async () => {
    let findManyArguments: Record<string, unknown> | undefined;
    const database = {
      order: {
        findMany: async (arguments_: Record<string, unknown>) => {
          findManyArguments = arguments_;
          return [{
            id: 'legacy-id', orderId: 'ORDER-LEGACY', status: OrderStatus.FAILED,
            hubspotContactId: 'contact-legacy', hubspotDealId: null,
            updatedAt: new Date('2026-10-20T12:00:00.000Z'),
            syncJob: { status: JobStatus.FAILED, lastError: 'Saved job failure.' },
            syncAttempts: [], _count: { syncAttempts: 0 },
          }];
        },
        count: async () => 1,
      },
    } as unknown as PrismaClient;
    const repository = new PrismaSyncMonitoringRepository(database);

    await expect(repository.listOrders(OrderStatus.FAILED, 'legacy@example.com', 50, 1)).resolves.toEqual({
      data: [expect.objectContaining({
        orderId: 'ORDER-LEGACY', orderStatus: 'FAILED', jobStatus: 'FAILED',
        latestAttemptStatus: null, attemptCount: 0, canRetry: true,
      })],
      pagination: { limit: 50, page: 1, totalItems: 1, totalPages: 1 },
    });
    expect(findManyArguments).toMatchObject({
      where: {
        AND: [
          { status: OrderStatus.FAILED },
          { OR: expect.arrayContaining([
            { orderId: { contains: 'legacy@example.com', mode: 'insensitive' } },
            { payload: { path: ['customer', 'email'], string_contains: 'legacy@example.com' } },
          ]) },
        ],
      }, skip: 0, take: 50,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  });
});
