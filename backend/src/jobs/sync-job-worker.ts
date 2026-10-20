import type { SyncJobRepository } from '../repositories/sync-job.repository.js';
import { WorkerLeaseLostError } from '../repositories/sync-job.repository.js';
import type { HubSpotSyncService } from '../services/hubspot-sync.service.js';

export class SyncJobWorker {
  constructor(
    private readonly syncJobRepository: SyncJobRepository,
    private readonly hubSpotSyncService: HubSpotSyncService,
    private readonly leaseDurationMs: number,
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
      await this.hubSpotSyncService.synchronize(job);
      await this.syncJobRepository.complete(job.id, job.order.id);
    } catch (error) {
      if (error instanceof WorkerLeaseLostError) {
        console.warn('Sync job lease was lost before completion.', { jobId: job.id });
        return true;
      }

      const message = error instanceof Error ? error.message : 'HubSpot synchronization failed.';
      try {
        await this.syncJobRepository.fail(job.id, job.order.id, message);
      } catch (failureError) {
        if (!(failureError instanceof WorkerLeaseLostError)) {
          throw failureError;
        }
      }
      console.error('HubSpot synchronization failed.', { jobId: job.id, error: message });
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
