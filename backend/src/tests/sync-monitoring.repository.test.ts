import { JobStatus, OrderStatus, PrismaClient } from '../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { PrismaSyncMonitoringRepository } from '../repositories/sync-monitoring.repository.js';

describe('PrismaSyncMonitoringRepository manual retry', () => {
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
});
