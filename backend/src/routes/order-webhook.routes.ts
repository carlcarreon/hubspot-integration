import { Router } from 'express';
import type { OrderWebhookController } from '../controllers/order-webhook.controller.js';
import { verifyWebhookSignature } from '../middleware/webhook-signature.js';
import type { WebhookSignatureService } from '../services/webhook-signature.service.js';

export function createOrderWebhookRouter(
  controller: OrderWebhookController,
  signatureService: WebhookSignatureService,
): Router {
  const router = Router();
  router.post('/orders', verifyWebhookSignature(signatureService), controller.receive);
  return router;
}
