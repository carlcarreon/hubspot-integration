import { describe, expect, it, vi } from 'vitest';
import { HubSpotHttpClient } from '../services/hubspot-client.service.js';

describe('HubSpotHttpClient property verification', () => {
  it('creates and verifies the unique external_order_id deal property when missing', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ hasUniqueValue: true }, { status: 201 }));
    const client = new HubSpotHttpClient('test-token', fetchImplementation);

    await client.ensureExternalOrderIdProperty();

    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      'https://api.hubapi.com/crm/properties/2026-09/deals/external_order_id',
      expect.any(Object),
    );
    const createRequest = fetchImplementation.mock.calls[1];
    expect(createRequest[0]).toBe('https://api.hubapi.com/crm/properties/2026-09/deals');
    expect(JSON.parse((createRequest[1] as RequestInit).body as string)).toMatchObject({
      name: 'external_order_id',
      hasUniqueValue: true,
    });
  });

  it('fails safely when an existing external_order_id property is not unique', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ hasUniqueValue: false }));
    const client = new HubSpotHttpClient('test-token', fetchImplementation);

    await expect(client.ensureExternalOrderIdProperty()).rejects.toThrow('is not unique');
  });

  it('uses HubSpot\'s deal_currency_code internal property when creating a deal', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: 'deal-1' }, { status: 201 }));
    const client = new HubSpotHttpClient('test-token', fetchImplementation);

    await client.createDeal({
      externalOrderId: 'ORD-10482',
      dealName: 'Order ORD-10482 - Maria Santos',
      amount: '900.00',
      currency: 'PHP',
      closeDate: '2026-09-20T06:32:00.000Z',
      pipelineId: 'pipeline-1',
      dealStageId: 'stage-1',
    });

    const request = fetchImplementation.mock.calls[0];
    expect(request[0]).toBe('https://api.hubapi.com/crm/objects/2026-09/deals');
    expect(JSON.parse((request[1] as RequestInit).body as string)).toEqual({
      properties: {
        external_order_id: 'ORD-10482',
        dealname: 'Order ORD-10482 - Maria Santos',
        amount: '900.00',
        deal_currency_code: 'PHP',
        closedate: '2026-09-20T06:32:00.000Z',
        pipeline: 'pipeline-1',
        dealstage: 'stage-1',
      },
    });
  });
});
