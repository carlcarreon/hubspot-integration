import type { OrderRepository, StoredOrder } from '../repositories/order.repository.js';
import { parseOrderCreatedWebhook } from '../validators/order-webhook.validator.js';

export type IngestOrderWebhookResult = {
  order: StoredOrder;
  duplicate: boolean;
};

export class OrderWebhookService {
  constructor(private readonly orderRepository: OrderRepository) {}

  async ingest(rawBody: Buffer): Promise<IngestOrderWebhookResult> {
    const payload = parseOrderCreatedWebhook(rawBody);
    const result = await this.orderRepository.createOrFindWithInitialJob(payload);

    return { order: result.order, duplicate: !result.created };
  }
}
