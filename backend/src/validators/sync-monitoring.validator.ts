import { z } from 'zod';
import { OrderStatus } from '../generated/prisma/client.js';

const orderStatusValues = [
  OrderStatus.PENDING,
  OrderStatus.PROCESSING,
  OrderStatus.SUCCESS,
  OrderStatus.FAILED,
] as const;

export const syncListQuerySchema = z.object({
  orderStatus: z.enum(orderStatusValues).optional(),
});

export function parseSyncListQuery(query: unknown): { orderStatus?: OrderStatus } {
  const parsed = syncListQuerySchema.safeParse(query);
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
