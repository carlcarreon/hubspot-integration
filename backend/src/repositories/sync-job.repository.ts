import {
  AttemptStatus,
  JobStatus,
  OrderStatus,
  Prisma,
} from '../generated/prisma/client.js';

export type ClaimedSyncJob = {
  id: string;
  attemptId: string;
  attemptNumber: number;
  attempts: number;
  maxAttempts: number;
  leaseUntil: Date;
  order: {
    id: string;
    orderId: string;
    payload: Prisma.JsonValue;
    hubspotContactId: string | null;
    hubspotDealId: string | null;
  };
};

export type HubSpotIds = {
  contactId: string;
  dealId: string;
};

export interface SyncJobRepository {
  claimNext(leaseUntil: Date): Promise<ClaimedSyncJob | null>;
  saveHubSpotIds(orderId: string, ids: { contactId?: string; dealId?: string }): Promise<void>;
  complete(job: ClaimedSyncJob, ids: HubSpotIds): Promise<void>;
  reschedule(job: ClaimedSyncJob, errorMessage: string, availableAt: Date): Promise<void>;
  fail(job: ClaimedSyncJob, errorMessage: string): Promise<void>;
}

type SyncJobClient = {
  syncJob: {
    findMany(args: Prisma.SyncJobFindManyArgs): Promise<Array<unknown>>;
    updateMany(args: Prisma.SyncJobUpdateManyArgs): Promise<{ count: number }>;
    findUniqueOrThrow(args: Prisma.SyncJobFindUniqueOrThrowArgs): Promise<unknown>;
  };
  syncAttempt: {
    create(args: Prisma.SyncAttemptCreateArgs): Promise<unknown>;
    updateMany(args: Prisma.SyncAttemptUpdateManyArgs): Promise<{ count: number }>;
  };
  order: {
    update(args: Prisma.OrderUpdateArgs): Promise<unknown>;
    findUniqueOrThrow(args: Prisma.OrderFindUniqueOrThrowArgs): Promise<unknown>;
  };
  $transaction<T>(fn: (transaction: SyncJobTransactionClient) => Promise<T>): Promise<T>;
};

type SyncJobTransactionClient = {
  syncJob: Pick<SyncJobClient['syncJob'], 'updateMany'>;
  syncAttempt: Pick<SyncJobClient['syncAttempt'], 'updateMany'>;
  order: Pick<SyncJobClient['order'], 'update' | 'findUniqueOrThrow'>;
};

type JobCandidate = { id: string; attempts: number; maxAttempts: number };
type ClaimedJobDatabaseRecord = {
  id: string;
  attempts: number;
  maxAttempts: number;
  order: ClaimedSyncJob['order'];
};
type ExpiredJobDatabaseRecord = {
  id: string;
  orderId: string;
  attempts: number;
  maxAttempts: number;
  order: Pick<ClaimedSyncJob['order'], 'hubspotContactId' | 'hubspotDealId'>;
};

export class WorkerLeaseLostError extends Error {
  constructor() {
    super('The sync job lease is no longer held by this worker.');
  }
}

export class PrismaSyncJobRepository implements SyncJobRepository {
  constructor(private readonly database: SyncJobClient) {}

  async claimNext(leaseUntil: Date): Promise<ClaimedSyncJob | null> {
    const now = new Date();
    await this.recoverExpiredLeases(now);

    const candidates = await this.database.syncJob.findMany({
      where: { status: JobStatus.PENDING, availableAt: { lte: now } },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      take: 20,
      select: { id: true, attempts: true, maxAttempts: true },
    }) as JobCandidate[];

    for (const candidate of candidates) {
      // A scheduled retry is never created at the limit. This guard also
      // protects legacy rows or a manually corrupted queue entry.
      if (candidate.attempts >= candidate.maxAttempts) {
        continue;
      }

      const claimed = await this.database.syncJob.updateMany({
        where: {
          id: candidate.id,
          status: JobStatus.PENDING,
          availableAt: { lte: now },
          attempts: candidate.attempts,
        },
        data: {
          status: JobStatus.PROCESSING,
          processingLeaseUntil: leaseUntil,
          attempts: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        continue;
      }

      const job = await this.database.syncJob.findUniqueOrThrow({
        where: { id: candidate.id },
        select: {
          id: true,
          attempts: true,
          maxAttempts: true,
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
      }) as ClaimedJobDatabaseRecord;
      const attempt = await this.database.syncAttempt.create({
        data: {
          orderId: job.order.id,
          attemptNumber: job.attempts,
          status: AttemptStatus.PROCESSING,
        },
        select: { id: true },
      }) as { id: string };
      await this.database.order.update({
        where: { id: job.order.id },
        data: {
          status: OrderStatus.PROCESSING,
          nextRetryAt: null,
          processingLeaseUntil: leaseUntil,
        },
      });

      return {
        id: job.id,
        attemptId: attempt.id,
        attemptNumber: job.attempts,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        leaseUntil,
        order: job.order,
      };
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

  async complete(job: ClaimedSyncJob, ids: HubSpotIds): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await assertLeaseHeld(transaction, job, {
        status: JobStatus.COMPLETED,
        processingLeaseUntil: null,
        lastError: null,
      });
      const attempt = await transaction.syncAttempt.updateMany({
        where: { id: job.attemptId, status: AttemptStatus.PROCESSING },
        data: {
          status: AttemptStatus.SUCCESS,
          hubspotContactId: ids.contactId,
          hubspotDealId: ids.dealId,
          errorMessage: null,
          completedAt: new Date(),
        },
      });
      if (attempt.count !== 1) {
        throw new WorkerLeaseLostError();
      }
      await transaction.order.update({
        where: { id: job.order.id },
        data: {
          status: OrderStatus.SUCCESS,
          hubspotContactId: ids.contactId,
          hubspotDealId: ids.dealId,
          nextRetryAt: null,
          processingLeaseUntil: null,
        },
      });
    });
  }

  async reschedule(job: ClaimedSyncJob, errorMessage: string, availableAt: Date): Promise<void> {
    await this.finishFailedAttempt(job, errorMessage, async (transaction, ids) => {
      await transaction.syncJob.updateMany({
        where: heldLeaseWhere(job),
        data: {
          status: JobStatus.PENDING,
          availableAt,
          processingLeaseUntil: null,
          lastError: sanitizeError(errorMessage),
        },
      });
      await transaction.order.update({
        where: { id: job.order.id },
        data: {
          status: OrderStatus.PENDING,
          hubspotContactId: ids.contactId,
          hubspotDealId: ids.dealId,
          nextRetryAt: availableAt,
          processingLeaseUntil: null,
        },
      });
    });
  }

  async fail(job: ClaimedSyncJob, errorMessage: string): Promise<void> {
    await this.finishFailedAttempt(job, errorMessage, async (transaction, ids) => {
      await transaction.syncJob.updateMany({
        where: heldLeaseWhere(job),
        data: {
          status: JobStatus.FAILED,
          processingLeaseUntil: null,
          lastError: sanitizeError(errorMessage),
        },
      });
      await transaction.order.update({
        where: { id: job.order.id },
        data: {
          status: OrderStatus.FAILED,
          hubspotContactId: ids.contactId,
          hubspotDealId: ids.dealId,
          nextRetryAt: null,
          processingLeaseUntil: null,
        },
      });
    });
  }

  private async recoverExpiredLeases(now: Date): Promise<void> {
    const expiredJobs = await this.database.syncJob.findMany({
      where: { status: JobStatus.PROCESSING, processingLeaseUntil: { lt: now } },
      orderBy: { processingLeaseUntil: 'asc' },
      take: 20,
      select: {
        id: true,
        orderId: true,
        attempts: true,
        maxAttempts: true,
        order: { select: { hubspotContactId: true, hubspotDealId: true } },
      },
    }) as ExpiredJobDatabaseRecord[];

    for (const expiredJob of expiredJobs) {
      const exhausted = expiredJob.attempts >= expiredJob.maxAttempts;
      await this.database.$transaction(async (transaction) => {
        const recovered = await transaction.syncJob.updateMany({
          where: {
            id: expiredJob.id,
            status: JobStatus.PROCESSING,
            processingLeaseUntil: { lt: now },
          },
          data: {
            status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
            availableAt: now,
            processingLeaseUntil: null,
            lastError: exhausted
              ? 'Processing lease expired after the maximum attempt count was reached.'
              : 'Processing lease expired; the job was safely reclaimed.',
          },
        });
        if (recovered.count !== 1) {
          return;
        }

        await transaction.syncAttempt.updateMany({
          where: {
            orderId: expiredJob.orderId,
            attemptNumber: expiredJob.attempts,
            status: AttemptStatus.PROCESSING,
          },
          data: {
            status: AttemptStatus.FAILED,
            hubspotContactId: expiredJob.order.hubspotContactId,
            hubspotDealId: expiredJob.order.hubspotDealId,
            errorMessage: 'Processing lease expired; the worker was restarted or interrupted.',
            completedAt: now,
          },
        });
        await transaction.order.update({
          where: { id: expiredJob.orderId },
          data: {
            status: exhausted ? OrderStatus.FAILED : OrderStatus.PENDING,
            nextRetryAt: exhausted ? null : now,
            processingLeaseUntil: null,
          },
        });
      });
    }
  }

  private async finishFailedAttempt(
    job: ClaimedSyncJob,
    errorMessage: string,
    updateJobAndOrder: (
      transaction: SyncJobTransactionClient,
      ids: { contactId: string | null; dealId: string | null },
    ) => Promise<void>,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const ids = await transaction.order.findUniqueOrThrow({
        where: { id: job.order.id },
        select: { hubspotContactId: true, hubspotDealId: true },
      }) as { hubspotContactId: string | null; hubspotDealId: string | null };
      const attempt = await transaction.syncAttempt.updateMany({
        where: { id: job.attemptId, status: AttemptStatus.PROCESSING },
        data: {
          status: AttemptStatus.FAILED,
          hubspotContactId: ids.hubspotContactId,
          hubspotDealId: ids.hubspotDealId,
          errorMessage: sanitizeError(errorMessage),
          completedAt: new Date(),
        },
      });
      if (attempt.count !== 1) {
        throw new WorkerLeaseLostError();
      }
      await assertLeaseHeld(transaction, job, {});
      await updateJobAndOrder(transaction, {
        contactId: ids.hubspotContactId,
        dealId: ids.hubspotDealId,
      });
    });
  }
}

async function assertLeaseHeld(
  transaction: SyncJobTransactionClient,
  job: ClaimedSyncJob,
  data: Prisma.SyncJobUpdateManyMutationInput,
): Promise<void> {
  const result = await transaction.syncJob.updateMany({ where: heldLeaseWhere(job), data });
  if (result.count !== 1) {
    throw new WorkerLeaseLostError();
  }
}

function heldLeaseWhere(job: ClaimedSyncJob): Prisma.SyncJobWhereInput {
  return {
    id: job.id,
    status: JobStatus.PROCESSING,
    processingLeaseUntil: job.leaseUntil,
  };
}

function sanitizeError(message: string): string {
  return message
    .replace(/[\r\n]+/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 1_000);
}
