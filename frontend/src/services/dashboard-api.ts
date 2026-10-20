export type OrderStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
export type AttemptStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type DashboardStats = {
  successful: number;
  failed: number;
  pending: number;
  processing: number;
};

export type SyncAttempt = {
  id: string;
  orderId: string;
  status: AttemptStatus;
  orderStatus: OrderStatus;
  jobStatus: JobStatus | null;
  canRetry: boolean;
  attemptNumber: number;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  errorMessage: string | null;
  httpStatusCode: number | null;
  hubspotErrorCategory: string | null;
  hubspotCorrelationId: string | null;
  retryState: 'SCHEDULED' | 'RETRIED' | 'TERMINAL' | null;
  retryScheduledFor: string | null;
  startedAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
};

export type OrderSyncStatus = {
  orderId: string;
  orderStatus: OrderStatus;
  jobStatus: JobStatus | null;
  latestAttemptStatus: AttemptStatus | null;
  canRetry: boolean;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  lastError: string | null;
  updatedAt: string;
  attemptCount: number;
};

export type OrdersPage = {
  data: OrderSyncStatus[];
  pagination: Pagination;
};

export type SyncAttemptsPage = { data: SyncAttempt[]; pagination: Pagination };
export type Pagination = { page: number; limit: number; totalItems: number; totalPages: number };

type ApiEnvelope<T> = { data: T };
type ApiErrorBody = { error?: { message?: string } };

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getSyncs(
  orderStatus: OrderStatus | undefined,
  q: string,
  limit: number,
  page: number,
): Promise<SyncAttemptsPage> {
  const parameters = new URLSearchParams({ q, limit: String(limit), page: String(page) });
  if (orderStatus) {
    parameters.set('orderStatus', orderStatus);
  }
  return pagedRequest<SyncAttemptsPage>(`/api/syncs?${parameters.toString()}`);
}

export function getStats(): Promise<DashboardStats> {
  return request<DashboardStats>('/api/syncs/stats');
}

export async function getOrders(
  status: OrderStatus | undefined,
  q: string,
  limit: number,
  page: number,
): Promise<OrdersPage> {
  const parameters = new URLSearchParams({ q, limit: String(limit), page: String(page) });
  if (status) {
    parameters.set('status', status);
  }
  return pagedRequest<OrdersPage>(`/api/orders?${parameters.toString()}`);
}

export function getOrderAttempts(orderId: string): Promise<SyncAttempt[]> {
  return request<SyncAttempt[]>(`/api/orders/${encodeURIComponent(orderId)}/attempts`);
}

export function retryOrder(orderId: string): Promise<void> {
  return request(`/api/orders/${encodeURIComponent(orderId)}/retry`, { method: 'POST' });
}

export async function downloadDealsCsv(days = 7): Promise<void> {
  const response = await fetch(`/api/exports/deals?days=${encodeURIComponent(String(days))}`);
  if (!response.ok) {
    throw new DashboardApiError(await errorMessage(response), response.status);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = attachmentFilename(response.headers.get('content-disposition'));
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...init.headers },
  });
  const body = (await response.json()) as ApiEnvelope<T> & ApiErrorBody;
  if (!response.ok) {
    throw new DashboardApiError(body.error?.message ?? 'The dashboard request failed.', response.status);
  }
  return body.data;
}

async function pagedRequest<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = (await response.json()) as T & ApiErrorBody;
  if (!response.ok) {
    throw new DashboardApiError(body.error?.message ?? 'The dashboard request failed.', response.status);
  }
  return body;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error?.message ?? 'The dashboard request failed.';
  } catch {
    return 'The dashboard request failed.';
  }
}

function attachmentFilename(contentDisposition: string | null): string {
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition ?? '');
  return match?.[1] ?? 'hubspot_deals_last_7_days.csv';
}
