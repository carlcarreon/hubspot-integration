import { describe, expect, it, vi } from 'vitest';
import { SyncJobWorker } from '../jobs/sync-job-worker.js';
import { RetryPolicy } from '../jobs/retry-policy.js';
import type { ClaimedSyncJob, SyncJobRepository } from '../repositories/sync-job.repository.js';
import { HubSpotApiError } from '../services/hubspot-client.service.js';
import type { HubSpotSyncService } from '../services/hubspot-sync.service.js';

const job: ClaimedSyncJob = {
  id: 'job-1',
  attemptId: 'attempt-1',
  attemptNumber: 1,
  attempts: 1,
  maxAttempts: 3,
  leaseUntil: new Date('2026-10-20T00:05:00.000Z'),
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
    reschedule: vi.fn(),
    fail: vi.fn(),
  };
}

function retryPolicy(): RetryPolicy {
  return new RetryPolicy(1_000, 60_000, () => 0.5);
}

describe('SyncJobWorker', () => {
  it('claims one job, synchronizes it, then completes that exact attempt', async () => {
    const repository = createRepository(job);
    const syncService = {
      verifySetup: vi.fn(),
      synchronize: vi.fn().mockResolvedValue({ contactId: 'contact-1', dealId: 'deal-1' }),
    } as unknown as HubSpotSyncService;
    const worker = new SyncJobWorker(repository, syncService, 300_000, retryPolicy());

    await expect(worker.processNext()).resolves.toBe(true);

    expect(syncService.synchronize).toHaveBeenCalledWith(job);
    expect(repository.complete).toHaveBeenCalledWith(job, { contactId: 'contact-1', dealId: 'deal-1' });
    expect(repository.reschedule).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('schedules a 429 failure using Retry-After rather than failing the job', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
    const repository = createRepository(job);
    const syncService = {
      verifySetup: vi.fn(),
      synchronize: vi.fn().mockRejectedValue(new HubSpotApiError(429, {
        codes: ['RATE_LIMITED'],
        messages: ['Too many requests.'],
        retryAfterMs: 10_000,
      })),
    } as unknown as HubSpotSyncService;
    const worker = new SyncJobWorker(repository, syncService, 300_000, retryPolicy());

    await expect(worker.processNext()).resolves.toBe(true);

    expect(repository.reschedule).toHaveBeenCalledWith(
      job,
      expect.stringContaining('status 429'),
      new Date('2026-10-20T00:00:10.000Z'),
    );
    expect(repository.fail).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('marks a permanent 400 failure as failed without scheduling another attempt', async () => {
    const repository = createRepository(job);
    const syncService = {
      verifySetup: vi.fn(),
      synchronize: vi.fn().mockRejectedValue(new HubSpotApiError(400, {
        codes: ['PROPERTY_DOESNT_EXIST'],
        messages: ['Property does not exist.'],
      })),
    } as unknown as HubSpotSyncService;
    const worker = new SyncJobWorker(repository, syncService, 300_000, retryPolicy());

    await expect(worker.processNext()).resolves.toBe(true);

    expect(repository.fail).toHaveBeenCalledWith(job, expect.stringContaining('status 400'));
    expect(repository.reschedule).not.toHaveBeenCalled();
  });
});
