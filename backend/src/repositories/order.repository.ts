import { Prisma } from '../generated/prisma/client.js';
import type { OrderCreatedWebhook } from '../validators/order-webhook.validator.js';

export type StoredOrder = {
  id: string;
  orderId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  createdAt: Date;
};

export type CreateOrderResult = {
  order: StoredOrder;
  created: boolean;
};

export interface OrderRepository {
  createOrFindWithInitialJob(payload: OrderCreatedWebhook): Promise<CreateOrderResult>;
}

type OrderClient = {
  order: {
    create(args: Prisma.OrderCreateArgs): Promise<StoredOrder>;
    findUniqueOrThrow(args: Prisma.OrderFindUniqueOrThrowArgs): Promise<StoredOrder>;
  };
};

const storedOrderSelect = {
  id: true,
  orderId: true,
  status: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

export class PrismaOrderRepository implements OrderRepository {
  constructor(
    private readonly database: OrderClient,
    private readonly maxJobAttempts = 8,
  ) {}

  async createOrFindWithInitialJob(payload: OrderCreatedWebhook): Promise<CreateOrderResult> {
    try {
      const order = await this.database.order.create({
        data: {
          orderId: payload.order_id,
          payload: payload as Prisma.InputJsonValue,
          syncJob: { create: { maxAttempts: this.maxJobAttempts } },
        },
        select: storedOrderSelect,
      });

      return { order, created: true };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      // PostgreSQL only raises this after the competing transaction has resolved,
      // so the durable order/job pair is visible before this lookup runs.
      const order = await this.database.order.findUniqueOrThrow({
        where: { orderId: payload.order_id },
        select: storedOrderSelect,
      });

      return { order, created: false };
    }
  }
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}
