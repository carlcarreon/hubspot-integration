import type { OrderStatus, SyncAttempt } from '../../services/dashboard-api';

export type DashboardView = 'orders' | 'attempts';
export type PageLimit = 10 | 20 | 50;
export type StatusFilter = OrderStatus | '';
export type AttemptHistory = Record<string, SyncAttempt[]>;
