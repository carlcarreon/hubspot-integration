import type { Request, Response } from 'express';
import type { HealthService } from '../services/health.service.js';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  check = async (_request: Request, response: Response): Promise<void> => {
    const health = await this.healthService.check();
    response.status(health.status === 'ok' ? 200 : 503).json(health);
  };
}
