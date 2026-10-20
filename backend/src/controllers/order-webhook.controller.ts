import type { Request, Response } from 'express';
import { OrderWebhookValidationError } from '../validators/order-webhook.validator.js';
import type { OrderWebhookService } from '../services/order-webhook.service.js';

export class OrderWebhookController {
  constructor(private readonly orderWebhookService: OrderWebhookService) {}

  receive = async (request: Request, response: Response): Promise<void> => {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Expected a request body.' } });
      return;
    }

    try {
      const result = await this.orderWebhookService.ingest(request.body);
      response.status(202).json({
        data: {
          orderId: result.order.orderId,
          status: result.order.status,
          duplicate: result.duplicate,
        },
      });
    } catch (error) {
      if (error instanceof OrderWebhookValidationError) {
        response.status(400).json({
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Webhook payload validation failed.',
            details: error.issues,
          },
        });
        return;
      }

      throw error;
    }
  };
}
