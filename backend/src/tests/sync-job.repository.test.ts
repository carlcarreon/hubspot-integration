import { describe, expect, it, vi } from 'vitest';
import { JobStatus, OrderStatus } from '../generated/prisma/client.js';
import {
  PrismaSyncJobRepository,
  type ClaimedSyncJob,
} from '../repositories/sync-job.repository.js';

const leaseUntil = new Date('2026-10-20T00:05:00.000Z');

type TestDatabase = {
  syncJob: {
    findMany: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  syncAttempt: {
    create: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  order: {
    update: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  $transaction: <T>(callback: (transaction: TestDatabase) => Promise<T>) => Promise<T>;
};

function claimedJob(): ClaimedSyncJob {
  return {
    id: 'job-1',
    attemptId: 'attempt-2',
    attemptNumber: 2,
    attempts: 2,
    maxAttempts: 3,
    leaseUntil,
    order: {
      id: 'order-1',
      orderId: 'ORD-10482',
      payload: {},
      hubspotContactId: 'contact-1',
      hubspotDealId: 'deal-1',
    },
  };
}

function createDatabase() {
  const syncJob = {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUniqueOrThrow: vi.fn(),
  };
  const syncAttempt = {
    create: vi.fn().mockResolvedValue({ id: 'attempt-2' }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const order = {
    update: vi.fn().mockResolvedValue({}),
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      hubspotContactId: 'contact-1',
      hubspotDealId: 'deal-1',
    }),
  };
  const database: TestDatabase = {
    syncJob,
    syncAttempt,
    order,
    $transaction: async <T>(callback: (transaction: TestDatabase) => Promise<T>): Promise<T> => callback(database),
  };
  return database;
}

describe('PrismaSyncJobRepository', () => {
  it('records an interrupted attempt and safely reclaims its expired lease as a new attempt', async () => {
    const database = createDatabase();
    database.syncJob.findMany
      .mockResolvedValueOnce([{
        id: 'job-1',
        orderId: 'order-1',
        attempts: 1,
        maxAttempts: 3,
        order: { hubspotContactId: 'contact-1', hubspotDealId: 'deal-1' },
      }])
      .mockResolvedValueOnce([{ id: 'job-1', attempts: 1, maxAttempts: 3 }]);
    database.syncJob.findUniqueOrThrow.mockResolvedValue({
      id: 'job-1',
      attempts: 2,
      maxAttempts: 3,
      order: {
        id: 'order-1',
        orderId: 'ORD-10482',
        payload: {},
        hubspotContactId: 'contact-1',
        hubspotDealId: 'deal-1',
      },
    });
    const repository = new PrismaSyncJobRepository(database as never);

    const claimed = await repository.claimNext(leaseUntil);

    expect(claimed).toMatchObject({
      id: 'job-1',
      attemptId: 'attempt-2',
      attemptNumber: 2,
      order: { hubspotContactId: 'contact-1', hubspotDealId: 'deal-1' },
    });
    expect(database.syncAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        errorMessage: expect.stringContaining('worker was restarted or interrupted'),
        hubspotContactId: 'contact-1',
        hubspotDealId: 'deal-1',
      }),
    }));
    expect(database.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OrderStatus.PENDING }),
    }));
    expect(database.syncAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ orderId: 'order-1', attemptNumber: 2 }),
    }));
  });

  it('records partial HubSpot IDs and schedules a failed retry attempt', async () => {
    const database = createDatabase();
    const repository = new PrismaSyncJobRepository(database as never);
    const nextRetryAt = new Date('2026-10-20T00:00:10.000Z');

    await repository.reschedule(claimedJob(), 'HubSpot request failed with status 503.', nextRetryAt);

    expect(database.syncAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        hubspotContactId: 'contact-1',
        hubspotDealId: 'deal-1',
        status: 'FAILED',
      }),
    }));
    expect(database.syncJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: JobStatus.PENDING, availableAt: nextRetryAt }),
    }));
    expect(database.order.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: OrderStatus.PENDING,
        nextRetryAt,
        hubspotContactId: 'contact-1',
        hubspotDealId: 'deal-1',
      }),
    }));
  });

  it('permanently fails an expired final attempt instead of leaving it pending', async () => {
    const database = createDatabase();
    database.syncJob.findMany
      .mockResolvedValueOnce([{
        id: 'job-final',
        orderId: 'order-final',
        attempts: 3,
        maxAttempts: 3,
        order: { hubspotContactId: 'contact-1', hubspotDealId: 'deal-1' },
      }])
      .mockResolvedValueOnce([]);
    const repository = new PrismaSyncJobRepository(database as never);

    await expect(repository.claimNext(leaseUntil)).resolves.toBeNull();

    expect(database.syncJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: JobStatus.FAILED }),
    }));
    expect(database.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OrderStatus.FAILED, nextRetryAt: null }),
    }));
  });
});
