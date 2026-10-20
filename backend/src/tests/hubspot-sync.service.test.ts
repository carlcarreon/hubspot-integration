import { describe, expect, it, vi } from 'vitest';
import type { ClaimedSyncJob, SyncJobRepository } from '../repositories/sync-job.repository.js';
import type { HubSpotClient } from '../services/hubspot-client.service.js';
import { HubSpotSyncService } from '../services/hubspot-sync.service.js';

const configuration = { pipelineId: 'pipeline-1', dealStageId: 'stage-1' };

function createJob(overrides: Partial<ClaimedSyncJob['order']> = {}): ClaimedSyncJob {
  return {
    id: 'job-1',
    attemptId: 'attempt-1',
    attemptNumber: 1,
    attempts: 1,
    maxAttempts: 8,
    leaseUntil: new Date('2026-10-20T00:05:00.000Z'),
    order: {
      id: 'order-1',
      orderId: 'ORD-10482',
      payload: {
        event: 'order.created',
        order_id: 'ORD-10482',
        created_at: '2026-09-20T14:32:00+08:00',
        customer: {
          email: 'Maria.Santos@Example.com',
          first_name: 'Maria',
          last_name: 'Santos',
          phone: '+639171234567',
        },
        items: [{ sku: 'TSH-BLK-M', name: 'Black Tee (M)', qty: 2, price: 450 }],
        currency: 'PHP',
        total: 900,
      },
      hubspotContactId: null,
      hubspotDealId: null,
      ...overrides,
    },
  };
}

function createHubSpotClient(overrides: Partial<HubSpotClient> = {}): HubSpotClient {
  return {
    ensureExternalOrderIdProperty: vi.fn(),
    findContactByEmail: vi.fn().mockResolvedValue(null),
    createContact: vi.fn().mockResolvedValue('contact-created'),
    updateContact: vi.fn(),
    findDealByExternalOrderId: vi.fn().mockResolvedValue(null),
    createDeal: vi.fn().mockResolvedValue('deal-created'),
    updateDeal: vi.fn(),
    associateDealWithContact: vi.fn(),
    ...overrides,
  };
}

function createRepository(): SyncJobRepository & { savedIds: Array<{ orderId: string; ids: object }> } {
  const savedIds: Array<{ orderId: string; ids: object }> = [];
  return {
    savedIds,
    claimNext: vi.fn(),
    saveHubSpotIds: vi.fn(async (orderId, ids) => { savedIds.push({ orderId, ids }); }),
    complete: vi.fn(),
    reschedule: vi.fn(),
    fail: vi.fn(),
  };
}

describe('HubSpotSyncService', () => {
  it('creates a contact and deal, maps all required properties, and associates them', async () => {
    const hubSpotClient = createHubSpotClient();
    const repository = createRepository();
    const service = new HubSpotSyncService(hubSpotClient, repository, configuration);

    await service.synchronize(createJob());

    expect(hubSpotClient.findContactByEmail).toHaveBeenCalledWith('maria.santos@example.com');
    expect(hubSpotClient.createContact).toHaveBeenCalledWith({
      email: 'maria.santos@example.com',
      firstName: 'Maria',
      lastName: 'Santos',
      phone: '+639171234567',
    });
    expect(hubSpotClient.createDeal).toHaveBeenCalledWith({
      externalOrderId: 'ORD-10482',
      dealName: 'Order ORD-10482 - Maria Santos',
      amount: '900.00',
      currency: 'PHP',
      closeDate: '2026-09-20T06:32:00.000Z',
      pipelineId: 'pipeline-1',
      dealStageId: 'stage-1',
    });
    expect(repository.savedIds).toEqual([
      { orderId: 'order-1', ids: { contactId: 'contact-created' } },
      { orderId: 'order-1', ids: { dealId: 'deal-created' } },
    ]);
    expect(hubSpotClient.associateDealWithContact).toHaveBeenCalledWith('deal-created', 'contact-created');
  });

  it('updates existing contact and deal records selected by their idempotency keys', async () => {
    const hubSpotClient = createHubSpotClient({
      findContactByEmail: vi.fn().mockResolvedValue('contact-existing'),
      findDealByExternalOrderId: vi.fn().mockResolvedValue('deal-existing'),
    });
    const repository = createRepository();
    const service = new HubSpotSyncService(hubSpotClient, repository, configuration);

    await service.synchronize(createJob());

    expect(hubSpotClient.createContact).not.toHaveBeenCalled();
    expect(hubSpotClient.updateContact).toHaveBeenCalledWith('contact-existing', expect.any(Object));
    expect(hubSpotClient.createDeal).not.toHaveBeenCalled();
    expect(hubSpotClient.updateDeal).toHaveBeenCalledWith('deal-existing', expect.objectContaining({
      externalOrderId: 'ORD-10482',
    }));
    expect(hubSpotClient.associateDealWithContact).toHaveBeenCalledWith('deal-existing', 'contact-existing');
  });

  it('reconciles a prior partial completion without creating a duplicate deal', async () => {
    const hubSpotClient = createHubSpotClient({
      findDealByExternalOrderId: vi.fn().mockResolvedValue('deal-reconciled'),
    });
    const repository = createRepository();
    const service = new HubSpotSyncService(hubSpotClient, repository, configuration);

    await service.synchronize(createJob({ hubspotContactId: 'contact-persisted' }));

    expect(hubSpotClient.findContactByEmail).not.toHaveBeenCalled();
    expect(hubSpotClient.updateContact).toHaveBeenCalledWith('contact-persisted', expect.any(Object));
    expect(hubSpotClient.findDealByExternalOrderId).toHaveBeenCalledWith('ORD-10482');
    expect(hubSpotClient.createDeal).not.toHaveBeenCalled();
    expect(hubSpotClient.updateDeal).toHaveBeenCalledWith('deal-reconciled', expect.any(Object));
    expect(hubSpotClient.associateDealWithContact).toHaveBeenCalledWith('deal-reconciled', 'contact-persisted');
  });

  it('persists both remote IDs before an association failure so a later attempt does not create duplicates', async () => {
    const hubSpotClient = createHubSpotClient({
      associateDealWithContact: vi.fn().mockRejectedValue(new Error('association unavailable')),
    });
    const repository = createRepository();
    const service = new HubSpotSyncService(hubSpotClient, repository, configuration);

    await expect(service.synchronize(createJob())).rejects.toThrow('association unavailable');

    expect(repository.savedIds).toEqual([
      { orderId: 'order-1', ids: { contactId: 'contact-created' } },
      { orderId: 'order-1', ids: { dealId: 'deal-created' } },
    ]);
  });

  it('updates persisted partial records instead of searching or creating duplicates after a retry', async () => {
    const hubSpotClient = createHubSpotClient();
    const repository = createRepository();
    const service = new HubSpotSyncService(hubSpotClient, repository, configuration);

    await service.synchronize(createJob({
      hubspotContactId: 'contact-persisted',
      hubspotDealId: 'deal-persisted',
    }));

    expect(hubSpotClient.findContactByEmail).not.toHaveBeenCalled();
    expect(hubSpotClient.findDealByExternalOrderId).not.toHaveBeenCalled();
    expect(hubSpotClient.createContact).not.toHaveBeenCalled();
    expect(hubSpotClient.createDeal).not.toHaveBeenCalled();
    expect(hubSpotClient.updateContact).toHaveBeenCalledWith('contact-persisted', expect.any(Object));
    expect(hubSpotClient.updateDeal).toHaveBeenCalledWith('deal-persisted', expect.any(Object));
  });
});
