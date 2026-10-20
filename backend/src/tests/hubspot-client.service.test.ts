import { afterEach, describe, expect, it, vi } from 'vitest';
import { HubSpotApiError, HubSpotHttpClient } from '../services/hubspot-client.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('retains a sanitized 429 response and Retry-After metadata', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      category: 'RATE_LIMITED',
      message: 'Too many requests for maria.santos@example.com.',
      correlationId: 'correlation-429',
      errors: [{ code: 'RATE_LIMITED', message: 'Try again later.' }],
    }, { status: 429, headers: { 'Retry-After': '7' } }));
    const client = new HubSpotHttpClient('private-token-must-not-appear', fetchImplementation);

    const error = await client.findContactByEmail('maria.santos@example.com').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HubSpotApiError);
    expect(error).toMatchObject({
      status: 429,
      retryable: true,
      metadata: {
        category: 'RATE_LIMITED',
        correlationId: 'correlation-429',
        retryAfterMs: 7_000,
        codes: ['RATE_LIMITED'],
      },
    });
    expect((error as Error).message).not.toContain('maria.santos@example.com');
    expect((error as Error).message).not.toContain('private-token-must-not-appear');
  });

  it.each([500, 503])('classifies HTTP %i as retryable', async (status) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      category: 'SERVER_ERROR',
      correlationId: `correlation-${status}`,
    }, { status }));
    const client = new HubSpotHttpClient('test-token', fetchImplementation);

    const error = await client.findDealByExternalOrderId('ORD-10482').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HubSpotApiError);
    expect((error as HubSpotApiError).retryable).toBe(true);
  });

  it('classifies HTTP 400 validation failures as permanent and safely exposes their correlation ID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      category: 'VALIDATION_ERROR',
      message: 'Property "deal_currency_code" does not exist',
      correlationId: 'correlation-400',
      errors: [{ code: 'PROPERTY_DOESNT_EXIST', message: 'Property does not exist' }],
    }, { status: 400 }));
    const client = new HubSpotHttpClient('test-token', fetchImplementation);

    const error = await client.findDealByExternalOrderId('ORD-10482').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HubSpotApiError);
    expect((error as HubSpotApiError).retryable).toBe(false);
    expect((error as Error).message).toContain('correlationId=correlation-400');
    expect((error as Error).message).toContain('PROPERTY_DOESNT_EXIST');
  });
});
