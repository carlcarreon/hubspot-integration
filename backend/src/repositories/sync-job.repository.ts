import { JobStatus, OrderStatus, Prisma } from '../generated/prisma/client.js';

export type ClaimedSyncJob = {
  id: string;
  order: {
    id: string;
    orderId: string;
    payload: Prisma.JsonValue;
    hubspotContactId: string | null;
    hubspotDealId: string | null;
  };
};

export interface SyncJobRepository {
  claimNext(leaseUntil: Date): Promise<ClaimedSyncJob | null>;
  saveHubSpotIds(orderId: string, ids: { contactId?: string; dealId?: string }): Promise<void>;
  complete(jobId: string, orderId: string): Promise<void>;
  fail(jobId: string, orderId: string, errorMessage: string): Promise<void>;
}

type SyncJobClient = {
  syncJob: {
    findMany(args: Prisma.SyncJobFindManyArgs): Promise<Array<{ id: string }>>;
    updateMany(args: Prisma.SyncJobUpdateManyArgs): Promise<{ count: number }>;
    findUniqueOrThrow(args: Prisma.SyncJobFindUniqueOrThrowArgs): Promise<unknown>;
  };
  order: {
    update(args: Prisma.OrderUpdateArgs): Promise<unknown>;
  };
  $transaction<T>(fn: (transaction: SyncJobTransactionClient) => Promise<T>): Promise<T>;
};

type SyncJobTransactionClient = {
  syncJob: Pick<SyncJobClient['syncJob'], 'updateMany'>;
  order: Pick<SyncJobClient['order'], 'update'>;
};

export class WorkerLeaseLostError extends Error {
  constructor() {
    super('The sync job lease is no longer held by this worker.');
  }
}

export class PrismaSyncJobRepository implements SyncJobRepository {
  constructor(private readonly database: SyncJobClient) {}

  async claimNext(leaseUntil: Date): Promise<ClaimedSyncJob | null> {
    // Conditional update is the atomic claim. Candidates are intentionally
    // re-checked by status so multiple worker processes cannot claim one job.
    const candidates = await this.database.syncJob.findMany({
      where: { status: JobStatus.PENDING, availableAt: { lte: new Date() } },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      take: 20,
      select: { id: true },
    });

    for (const candidate of candidates) {
      const claimed = await this.database.syncJob.updateMany({
        where: {
          id: candidate.id,
          status: JobStatus.PENDING,
          availableAt: { lte: new Date() },
        },
        data: {
          status: JobStatus.PROCESSING,
          processingLeaseUntil: leaseUntil,
          attempts: { increment: 1 },
        },
      });

      if (claimed.count === 1) {
        return this.database.syncJob.findUniqueOrThrow({
          where: { id: candidate.id },
          select: {
            id: true,
            order: {
              select: {
                id: true,
                orderId: true,
                payload: true,
                hubspotContactId: true,
                hubspotDealId: true,
              },
            },
          },
        }) as Promise<ClaimedSyncJob>;
      }
    }

    return null;
  }

  async saveHubSpotIds(orderId: string, ids: { contactId?: string; dealId?: string }): Promise<void> {
    await this.database.order.update({
      where: { id: orderId },
      data: {
        ...(ids.contactId ? { hubspotContactId: ids.contactId } : {}),
        ...(ids.dealId ? { hubspotDealId: ids.dealId } : {}),
      },
    });
  }

  async complete(jobId: string, orderId: string): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const result = await transaction.syncJob.updateMany({
        where: { id: jobId, status: JobStatus.PROCESSING },
        data: { status: JobStatus.COMPLETED, processingLeaseUntil: null, lastError: null },
      });
      if (result.count !== 1) {
        throw new WorkerLeaseLostError();
      }
      await transaction.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.SUCCESS, nextRetryAt: null, processingLeaseUntil: null },
      });
    });
  }

  async fail(jobId: string, orderId: string, errorMessage: string): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const result = await transaction.syncJob.updateMany({
        where: { id: jobId, status: JobStatus.PROCESSING },
        data: {
          status: JobStatus.FAILED,
          processingLeaseUntil: null,
          lastError: sanitizeError(errorMessage),
        },
      });
      if (result.count !== 1) {
        throw new WorkerLeaseLostError();
      }
      await transaction.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.FAILED, processingLeaseUntil: null },
      });
    });
  }
}

function sanitizeError(message: string): string {
  return message.replace(/[\r\n]+/g, ' ').slice(0, 1_000);
}
