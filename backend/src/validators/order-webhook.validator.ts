import { z } from 'zod';

const customerSchema = z.object({
  email: z.string().trim().email().max(254),
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(3).max(30),
}).strict();

const itemSchema = z.object({
  sku: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(500),
  qty: z.number().int().positive().max(10_000),
  price: z.number().finite().nonnegative().max(100_000_000),
}).strict();

export const orderCreatedWebhookSchema = z.object({
  event: z.literal('order.created'),
  order_id: z.string().trim().min(1).max(128),
  created_at: z.string().datetime({ offset: true }),
  customer: customerSchema,
  items: z.array(itemSchema).min(1).max(1_000),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected a three-letter uppercase currency code.'),
  total: z.number().finite().nonnegative().max(100_000_000),
}).strict();

export type OrderCreatedWebhook = z.infer<typeof orderCreatedWebhookSchema>;

export class OrderWebhookValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super('Invalid order.created webhook payload.');
  }
}

export function parseOrderCreatedWebhook(rawBody: Buffer): OrderCreatedWebhook {
  let value: unknown;

  try {
    value = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new OrderWebhookValidationError([{ path: 'body', message: 'Expected valid JSON.' }]);
  }

  const result = orderCreatedWebhookSchema.safeParse(value);
  if (!result.success) {
    throw new OrderWebhookValidationError(result.error.issues.map((issue) => ({
      path: issue.path.join('.') || 'body',
      message: issue.message,
    })));
  }

  return result.data;
}
