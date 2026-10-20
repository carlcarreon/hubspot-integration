import type { Request, Response } from 'express';
import {
  OrderCannotBeRetriedError,
  OrderNotFoundError,
} from '../repositories/sync-monitoring.repository.js';
import type { SyncMonitoringService } from '../services/sync-monitoring.service.js';
import {
  parseSyncListQuery,
  SyncMonitoringValidationError,
} from '../validators/sync-monitoring.validator.js';

export class SyncMonitoringController {
  constructor(private readonly service: SyncMonitoringService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    try {
      const { orderStatus } = parseSyncListQuery(request.query);
      response.json({ data: await this.service.list(orderStatus) });
    } catch (error) {
      if (error instanceof SyncMonitoringValidationError) {
        response.status(400).json({
          error: { code: 'INVALID_QUERY', message: 'The order-status filter is invalid.' },
        });
        return;
      }
      throw error;
    }
  };

  stats = async (_request: Request, response: Response): Promise<void> => {
    response.json({ data: await this.service.stats() });
  };

  detail = async (request: Request, response: Response): Promise<void> => {
    const attemptId = request.params.id;
    if (typeof attemptId !== 'string') {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sync attempt not found.' } });
      return;
    }
    const attempt = await this.service.findAttempt(attemptId);
    if (!attempt) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Sync attempt not found.' } });
      return;
    }
    response.json({ data: attempt });
  };

  retry = async (request: Request, response: Response): Promise<void> => {
    try {
      const orderId = request.params.orderId;
      if (typeof orderId !== 'string') {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found.' } });
        return;
      }
      const retried = await this.service.retryFailedOrder(orderId);
      response.status(202).json({ data: retried });
    } catch (error) {
      if (error instanceof OrderNotFoundError) {
        response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found.' } });
        return;
      }
      if (error instanceof OrderCannotBeRetriedError) {
        response.status(409).json({
          error: { code: 'RETRY_NOT_AVAILABLE', message: 'Only an unclaimed failed order can be retried.' },
        });
        return;
      }
      throw error;
    }
  };
}
