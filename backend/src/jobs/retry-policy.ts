import { HubSpotApiError, HubSpotTransportError } from '../services/hubspot-client.service.js';

export type RetryDecision =
  | { retry: true; delayMs: number; reason: string }
  | { retry: false; reason: string };

export class RetryPolicy {
  constructor(
    private readonly baseDelayMs: number,
    private readonly maxDelayMs: number,
    private readonly random: () => number = Math.random,
  ) {}

  decide(error: unknown, attemptNumber: number, maxAttempts: number): RetryDecision {
    if (!isRetryableFailure(error)) {
      return { retry: false, reason: 'The failure is not retryable.' };
    }

    if (attemptNumber >= maxAttempts) {
      return { retry: false, reason: 'The maximum processing attempt count was reached.' };
    }

    const exponentialDelayMs = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * (2 ** Math.max(0, attemptNumber - 1)),
    );
    // Full jitter prevents workers that fail together from retrying together.
    const jitteredDelayMs = Math.floor(this.random() * (exponentialDelayMs + 1));
    const retryAfterMs = error instanceof HubSpotApiError ? error.metadata.retryAfterMs : undefined;
    const serverDelayMs = retryAfterMs === undefined
      ? 0
      : Math.min(retryAfterMs, this.maxDelayMs);

    return {
      retry: true,
      delayMs: Math.max(jitteredDelayMs, serverDelayMs),
      reason: retryAfterMs === undefined
        ? 'Retryable HubSpot failure.'
        : 'Retryable HubSpot failure with Retry-After.',
    };
  }
}

export function isRetryableFailure(error: unknown): boolean {
  return (error instanceof HubSpotApiError || error instanceof HubSpotTransportError) && error.retryable;
}
