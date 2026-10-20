import { describe, expect, it, vi } from 'vitest';
import type { ClaimedSyncJob, SyncJobRepository } from '../repositories/sync-job.repository.js';
import { SyncJobWorker } from '../jobs/sync-job-worker.js';
import type { HubSpotSyncService } from '../services/hubspot-sync.service.js';

const job: ClaimedSyncJob = {
  id: 'job-1',
  order: {
    id: 'order-1',
    orderId: 'ORD-10482',
    payload: {},
    hubspotContactId: null,
    hubspotDealId: null,
  },
};

function createRepository(claimedJob: ClaimedSyncJob | null): SyncJobRepository {
  return {
    claimNext: vi.fn().mockResolvedValue(claimedJob),
    saveHubSpotIds: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  };
}

describe('SyncJobWorker', () => {
  it('claims one job, synchronizes it, then completes that exact job', async () => {
    const repository = createRepository(job);
    const syncService = {
      verifySetup: vi.fn(),
      synchronize: vi.fn(),
    } as unknown as HubSpotSyncService;
    const worker = new SyncJobWorker(repository, syncService, 300_000);

    await expect(worker.processNext()).resolves.toBe(true);

    expect(syncService.synchronize).toHaveBeenCalledWith(job);
    expect(repository.complete).toHaveBeenCalledWith('job-1', 'order-1');
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('marks a claimed job failed when synchronization throws', async () => {
    const repository = createRepository(job);
    const syncService = {
      verifySetup: vi.fn(),
      synchronize: vi.fn().mockRejectedValue(new Error('HubSpot write failed')),
    } as unknown as HubSpotSyncService;
    const worker = new SyncJobWorker(repository, syncService, 300_000);

    await expect(worker.processNext()).resolves.toBe(true);

    expect(repository.fail).toHaveBeenCalledWith('job-1', 'order-1', 'HubSpot write failed');
  });
});
