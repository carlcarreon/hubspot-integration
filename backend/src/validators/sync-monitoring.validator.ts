import { z } from 'zod';
import { OrderStatus } from '../generated/prisma/client.js';

const orderStatusValues = [
  OrderStatus.PENDING,
  OrderStatus.PROCESSING,
  OrderStatus.SUCCESS,
  OrderStatus.FAILED,
] as const;

const normalizedOrderStatus = z.preprocess(
  (value) => typeof value === 'string' ? value.toUpperCase() : value,
  z.enum(orderStatusValues).optional(),
);

const paginationFields = {
  q: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().refine((value) => [10, 20, 50].includes(value), 'Invalid limit').default(20),
  page: z.coerce.number().int().min(1).default(1),
};

export const syncListQuerySchema = z.object({
  orderStatus: normalizedOrderStatus,
  ...paginationFields,
});

const failedOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ordersQuerySchema = z.object({
  status: normalizedOrderStatus,
  ...paginationFields,
});

export function parseSyncListQuery(query: unknown): { orderStatus?: OrderStatus; q: string; limit: number; page: number } {
  const parsed = syncListQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new SyncMonitoringValidationError();
  }
  return parsed.data;
}

export function parseFailedOrdersQuery(query: unknown): { limit: number; offset: number } {
  const parsed = failedOrdersQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new SyncMonitoringValidationError();
  }
  return parsed.data;
}

export function parseOrdersQuery(query: unknown): { status?: OrderStatus; q: string; limit: number; page: number } {
  const parsed = ordersQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new SyncMonitoringValidationError();
  }
  return parsed.data;
}

export class SyncMonitoringValidationError extends Error {
  constructor() {
    super('Invalid sync monitoring query.');
  }
}
