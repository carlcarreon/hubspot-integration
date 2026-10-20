import type { SyncJobRepository } from '../repositories/sync-job.repository.js';
import { WorkerLeaseLostError } from '../repositories/sync-job.repository.js';
import type { HubSpotSyncService } from '../services/hubspot-sync.service.js';
import { RetryPolicy } from './retry-policy.js';

export class SyncJobWorker {
  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly hubSpotSyncService: HubSpotSyncService,
    private readonly leaseDurationMs: number,
    private readonly retryPolicy: RetryPolicy,
  ) {}

  async verifySetup(): Promise<void> {
    await this.hubSpotSyncService.verifySetup();
  }

  async processNext(): Promise<boolean> {
    const job = await this.syncJobRepository.claimNext(new Date(Date.now() + this.leaseDurationMs));
    if (!job) {
      return false;
    }

    try {
      const ids = await this.hubSpotSyncService.synchronize(job);
      await this.syncJobRepository.complete(job, ids);
      console.info('HubSpot synchronization completed.', {
        jobId: job.id,
        orderId: job.order.orderId,
        attempt: job.attemptNumber,
      });
    } catch (error) {
      if (error instanceof WorkerLeaseLostError) {
        console.warn('Sync job lease was lost before completion.', { jobId: job.id });
        return true;
      }

      const message = error instanceof Error ? error.message : 'HubSpot synchronization failed.';
      const retry = this.retryPolicy.decide(error, job.attemptNumber, job.maxAttempts);
      try {
        if (retry.retry) {
          const availableAt = new Date(Date.now() + retry.delayMs);
          await this.syncJobRepository.reschedule(job, message, availableAt);
          console.warn('HubSpot synchronization will retry.', {
            jobId: job.id,
            attempt: job.attemptNumber,
            maxAttempts: job.maxAttempts,
            delayMs: retry.delayMs,
            error: message,
          });
        } else {
          await this.syncJobRepository.fail(job, message);
          console.error('HubSpot synchronization failed permanently.', {
            jobId: job.id,
            attempt: job.attemptNumber,
            maxAttempts: job.maxAttempts,
            reason: retry.reason,
            error: message,
          });
        }
      } catch (failureError) {
        if (!(failureError instanceof WorkerLeaseLostError)) {
          throw failureError;
        }
      }
    }

    return true;
  }

  async run(pollIntervalMs: number, shouldStop: () => boolean): Promise<void> {
    await this.verifySetup();
    while (!shouldStop()) {
      const processed = await this.processNext();
      if (!processed) {
        await delay(pollIntervalMs);
      }
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
