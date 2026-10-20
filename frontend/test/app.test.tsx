// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function selectOption(label: string, option: string): Promise<void> {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: label }));
  const optionElement = await screen.findByRole('option', { name: option });
  fireEvent.pointerDown(optionElement, { pointerType: 'mouse', buttons: 1 });
  fireEvent.click(optionElement, { detail: 1 });
}

const stats = { data: { successful: 4, failed: 2, pending: 2, processing: 3 } };
const orders = {
  data: [
    {
      orderId: 'ORDER-FAILED',
      orderStatus: 'FAILED',
      jobStatus: 'FAILED',
      latestAttemptStatus: 'FAILED',
      canRetry: true,
      hubspotContactId: 'contact-1',
      hubspotDealId: 'deal-1',
      lastError: 'Retry later.',
      updatedAt: '2026-10-20T12:01:00.000Z',
      attemptCount: 1,
    },
    {
      orderId: 'ORDER-LEGACY',
      orderStatus: 'FAILED',
      jobStatus: 'FAILED',
      latestAttemptStatus: null,
      canRetry: true,
      hubspotContactId: 'contact-legacy',
      hubspotDealId: null,
      lastError: 'Saved legacy failure.',
      updatedAt: '2026-10-20T11:01:00.000Z',
      attemptCount: 0,
    },
    {
      orderId: 'ORDER-SUCCESS',
      orderStatus: 'SUCCESS',
      jobStatus: 'COMPLETED',
      latestAttemptStatus: 'SUCCESS',
      canRetry: false,
      hubspotContactId: 'contact-2',
      hubspotDealId: 'deal-2',
      lastError: null,
      updatedAt: '2026-10-20T10:01:00.000Z',
      attemptCount: 1,
    },
  ],
  pagination: { page: 1, limit: 20, totalItems: 3, totalPages: 1 },
};
const failedOrders = {
  data: orders.data.slice(0, 2),
  pagination: { page: 1, limit: 20, totalItems: 2, totalPages: 1 },
};
const attempts = {
  data: [
    {
      id: 'attempt-1',
      orderId: 'ORDER-FAILED',
      status: 'FAILED',
      orderStatus: 'FAILED',
      jobStatus: 'FAILED',
      canRetry: true,
      attemptNumber: 1,
      hubspotContactId: 'contact-1',
      hubspotDealId: 'deal-1',
      errorMessage: 'Retry later.',
      httpStatusCode: 400,
      hubspotErrorCategory: 'VALIDATION_ERROR',
      hubspotCorrelationId: 'correlation-terminal',
      retryState: 'TERMINAL',
      retryScheduledFor: null,
      startedAt: '2026-10-20T12:00:00.000Z',
      completedAt: '2026-10-20T12:01:00.000Z',
      nextRetryAt: null,
    },
  ],
  pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
};

const successfulRetryHistory = {
  data: [
    {
      id: 'attempt-3',
      orderId: 'ORDER-SUCCESS',
      status: 'SUCCESS',
      orderStatus: 'SUCCESS',
      jobStatus: 'COMPLETED',
      canRetry: false,
      attemptNumber: 3,
      hubspotContactId: 'contact-2',
      hubspotDealId: 'deal-2',
      errorMessage: null,
      httpStatusCode: null,
      hubspotErrorCategory: null,
      hubspotCorrelationId: null,
      retryState: null,
      retryScheduledFor: null,
      startedAt: '2026-10-20T12:10:00.000Z',
      completedAt: '2026-10-20T12:11:00.000Z',
      nextRetryAt: null,
    },
    {
      id: 'attempt-2',
      orderId: 'ORDER-SUCCESS',
      status: 'FAILED',
      orderStatus: 'SUCCESS',
      jobStatus: 'COMPLETED',
      canRetry: false,
      attemptNumber: 2,
      hubspotContactId: 'contact-2',
      hubspotDealId: 'deal-2',
      errorMessage:
        'HubSpot request failed with status 503. RATE_LIMITED; correlationId=correlation-retried; Temporary failure.',
      httpStatusCode: 503,
      hubspotErrorCategory: 'RATE_LIMITED',
      hubspotCorrelationId: 'correlation-retried',
      retryState: 'RETRIED',
      retryScheduledFor: null,
      startedAt: '2026-10-20T12:05:00.000Z',
      completedAt: '2026-10-20T12:06:00.000Z',
      nextRetryAt: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('dashboard', () => {
  it('renders one current-order table, including a failed legacy order with no attempt history', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(screen.getByLabelText('Loading orders')).toBeTruthy();
    await screen.findByText('ORDER-LEGACY');
    expect(screen.getByText('Orders & Sync Status')).toBeTruthy();
    expect(screen.getAllByText('FAILED').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show 0 attempts for ORDER-LEGACY' }));
    await screen.findByText('No recorded sync attempts for this order.');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/orders/ORDER-LEGACY/attempts');
  });

  it('sends status filtering to the orders API instead of filtering the loaded page in the browser', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(failedOrders));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-SUCCESS');
    await selectOption('Current status', 'Failed');
    await screen.findByText('ORDER-LEGACY');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/orders?q=&limit=20&page=1&status=FAILED');
    expect(window.location.search).toBe('?view=orders&status=failed&page=1&limit=20');
  });

  it('restores a shared status filter from the browser URL', async () => {
    window.history.replaceState({}, '', '/?status=FAILED');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(failedOrders));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-LEGACY');
    expect(screen.getByRole('combobox', { name: 'Current status' }).textContent).toContain('Failed');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/orders?q=&limit=20&page=1&status=FAILED');
  });

  it('debounces a combined status and search request, then stores the query in the URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(failedOrders))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(
        jsonResponse({ data: [orders.data[1]], pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-SUCCESS');
    await selectOption('Current status', 'Failed');
    await screen.findByText('ORDER-LEGACY');
    fireEvent.change(screen.getByLabelText('Search orders, email, or HubSpot ID'), {
      target: { value: 'ORDER-LEGACY' },
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls[5][0]).toBe('/api/orders?q=ORDER-LEGACY&limit=20&page=1&status=FAILED'),
    );
    expect(window.location.search).toBe('?view=orders&status=failed&q=ORDER-LEGACY&page=1&limit=20');
  });

  it('restores all state from a browser Back or Forward navigation event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(attempts));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-FAILED');
    window.history.replaceState({}, '', '/?view=attempts&status=failed&q=ORDER-FAILED&page=1&limit=10');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await screen.findByText('Attempt 1');
    expect(screen.getByRole('combobox', { name: 'Current status' }).textContent).toContain('Failed');
    expect(screen.getByLabelText('Search orders, email, or HubSpot ID')).toHaveProperty('value', 'ORDER-FAILED');
    expect(screen.getByRole('combobox', { name: 'Rows' }).textContent).toContain('10');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/syncs?q=ORDER-FAILED&limit=10&page=1&orderStatus=FAILED');
  });

  it('shows the latest 50 real attempts in the unified table component', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(attempts));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-FAILED');
    fireEvent.click(screen.getByRole('tab', { name: 'Attempts (Latest 50)' }));
    await screen.findByText('Attempt 1');
    expect(screen.getByText('Terminal failure')).toBeTruthy();
    expect(fetchMock.mock.calls[3][0]).toBe('/api/syncs?q=&limit=20&page=1');
  });

  it('keeps a retried failure visible with its stored diagnostics after a later successful attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(jsonResponse(successfulRetryHistory));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-SUCCESS');
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 attempt for ORDER-SUCCESS' }));
    await screen.findByText('Stored error:');
    expect(screen.getByText('Retried later')).toBeTruthy();
    expect(screen.getByText('HTTP status')).toBeTruthy();
    expect(screen.getByText('503')).toBeTruthy();
    expect(screen.getByText('HubSpot category')).toBeTruthy();
    expect(screen.getByText('RATE_LIMITED')).toBeTruthy();
    expect(screen.getByText('Correlation ID')).toBeTruthy();
    expect(screen.getByText('correlation-retried')).toBeTruthy();
    expect(screen.getAllByText('No error recorded.').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/orders/ORDER-SUCCESS/attempts');
  });

  it('confirms and submits an eligible retry before refreshing orders', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(
        jsonResponse({ data: { orderId: 'ORDER-FAILED', status: 'PENDING', jobStatus: 'PENDING' } }, 202),
      )
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(
        jsonResponse({ data: [], pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-FAILED');
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry order' }));
    await waitFor(() => expect(screen.getByText('Order ORDER-FAILED was queued for retry.')).toBeTruthy());
    expect(fetchMock.mock.calls[2][0]).toBe('/api/orders/ORDER-FAILED/retry');
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });

  it('downloads the seven-day CSV without exposing HubSpot credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(orders))
      .mockResolvedValueOnce(
        new Response('Deal ID\n1\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="hubspot_deals_last_7_days.csv"',
          },
        }),
      );
    const createObjectUrl = vi.fn(() => 'blob:deal-export');
    const revokeObjectUrl = vi.fn();
    Object.assign(URL, { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('ORDER-FAILED');
    fireEvent.click(screen.getByRole('button', { name: 'Export Deals (Last 7 Days)' }));
    await waitFor(() => expect(screen.getByText('Deal CSV download started.')).toBeTruthy());
    expect(fetchMock.mock.calls[2][0]).toBe('/api/exports/deals?days=7');
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:deal-export');
    click.mockRestore();
  });
});
