import { describe, expect, it } from 'vitest';
import { RetryPolicy } from '../jobs/retry-policy.js';
import { HubSpotApiError, HubSpotTransportError } from '../services/hubspot-client.service.js';

const policy = new RetryPolicy(1_000, 10_000, () => 0.5);

describe('RetryPolicy', () => {
  it.each([429, 500, 503])('schedules retryable HubSpot status %i', (status) => {
    const decision = policy.decide(new HubSpotApiError(status, { codes: [], messages: [] }), 1, 3);

    expect(decision).toEqual({ retry: true, delayMs: 500, reason: 'Retryable HubSpot failure.' });
  });

  it('caps Retry-After at the configured maximum while honoring it over jitter', () => {
    const decision = policy.decide(new HubSpotApiError(429, {
      codes: [],
      messages: [],
      retryAfterMs: 120_000,
    }), 2, 3);

    expect(decision).toEqual({
      retry: true,
      delayMs: 10_000,
      reason: 'Retryable HubSpot failure with Retry-After.',
    });
  });

  it('does not retry permanent 400 responses or an exhausted retryable job', () => {
    expect(policy.decide(new HubSpotApiError(400, { codes: [], messages: [] }), 1, 3))
      .toEqual({ retry: false, reason: 'The failure is not retryable.' });
    expect(policy.decide(new HubSpotApiError(503, { codes: [], messages: [] }), 3, 3))
      .toEqual({ retry: false, reason: 'The maximum processing attempt count was reached.' });
  });

  it('retries a transport error', () => {
    const decision = policy.decide(new HubSpotTransportError(new Error('socket closed')), 1, 3);

    expect(decision).toMatchObject({ retry: true, delayMs: 500 });
  });
});
