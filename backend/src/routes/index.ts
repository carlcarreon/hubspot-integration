import { Router } from 'express';
import { HealthController } from '../controllers/health.controller.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';
import { HealthService } from '../services/health.service.js';
import { createHealthRouter } from './health.routes.js';

export function createApiRouter(dependencies: {
  healthRepository: PrismaHealthRepository;
}): Router {
  const router = Router();
  const healthService = new HealthService(dependencies.healthRepository);
  const healthController = new HealthController(healthService);

  router.use(createHealthRouter(healthController));
  return router;
}
