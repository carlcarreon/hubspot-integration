// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const stats = { data: { successful: 4, failed: 1, pending: 2, processing: 3 } };
const attempts = {
  data: [{
    id: 'attempt-1', orderId: 'ORDER-FAILED', status: 'FAILED', orderStatus: 'FAILED', attemptNumber: 2,
    hubspotContactId: 'contact-1', hubspotDealId: 'deal-1', errorMessage: 'Retry later.',
    startedAt: '2026-10-20T12:00:00.000Z', completedAt: '2026-10-20T12:01:00.000Z', nextRetryAt: null,
  }, {
    id: 'attempt-2', orderId: 'ORDER-SUCCESS', status: 'SUCCESS', orderStatus: 'SUCCESS', attemptNumber: 1,
    hubspotContactId: 'contact-2', hubspotDealId: 'deal-2', errorMessage: null,
    startedAt: '2026-10-20T11:00:00.000Z', completedAt: '2026-10-20T11:01:00.000Z', nextRetryAt: null,
  }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('dashboard', () => {
  it('shows a loading state and renders live summary and attempt data', async () => {
    let resolveStats: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveStats = resolve; }))
      .mockResolvedValueOnce(jsonResponse(attempts));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(screen.getByLabelText('Loading sync attempts')).toBeTruthy();
    resolveStats?.(jsonResponse(stats));

    await screen.findByText('ORDER-FAILED');
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('Retry later.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Retry' })[1]).toHaveProperty('disabled', true);
  });

  it('confirms and submits a failed-order retry before refreshing the dashboard', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(attempts))
      .mockResolvedValueOnce(jsonResponse({ data: { orderId: 'ORDER-FAILED', status: 'PENDING', jobStatus: 'PENDING' } }, 202))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-FAILED');
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry order' }));

    await waitFor(() => expect(screen.getByText('Order ORDER-FAILED was queued for retry.')).toBeTruthy());
    expect(fetchMock.mock.calls[2][0]).toBe('/api/orders/ORDER-FAILED/retry');
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });
});
