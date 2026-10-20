import type { NextFunction, Request, Response } from 'express';
import type { WebhookSignatureService } from '../services/webhook-signature.service.js';

export function verifyWebhookSignature(signatureService: WebhookSignatureService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const signature = request.get('X-Webhook-Signature');
    const rawBody = request.body;

    if (!Buffer.isBuffer(rawBody) || !signatureService.verify(rawBody, signature)) {
      response.status(401).json({
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature is missing or invalid.' },
      });
      return;
    }

    next();
  };
}
