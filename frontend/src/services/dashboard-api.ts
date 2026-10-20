export type OrderStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
export type AttemptStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';

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
  attemptNumber: number;
  hubspotContactId: string | null;
  hubspotDealId: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  nextRetryAt: string | null;
};

type ApiEnvelope<T> = { data: T };
type ApiErrorBody = { error?: { message?: string } };

export class DashboardApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function getSyncs(orderStatus?: OrderStatus): Promise<SyncAttempt[]> {
  const parameters = new URLSearchParams();
  if (orderStatus) {
    parameters.set('orderStatus', orderStatus);
  }
  const suffix = parameters.size ? `?${parameters.toString()}` : '';
  return request<SyncAttempt[]>(`/api/syncs${suffix}`);
}

export function getStats(): Promise<DashboardStats> {
  return request<DashboardStats>('/api/syncs/stats');
}

export function retryOrder(orderId: string): Promise<void> {
  return request(`/api/orders/${encodeURIComponent(orderId)}/retry`, { method: 'POST' });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...init.headers },
  });
  const body = await response.json() as ApiEnvelope<T> & ApiErrorBody;
  if (!response.ok) {
    throw new DashboardApiError(body.error?.message ?? 'The dashboard request failed.', response.status);
  }
  return body.data;
}
