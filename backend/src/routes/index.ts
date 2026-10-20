import { Router } from 'express';
import { HealthController } from '../controllers/health.controller.js';
import type { HealthRepository } from '../repositories/health.repository.js';
import type { SyncMonitoringRepository } from '../repositories/sync-monitoring.repository.js';
import { HealthService } from '../services/health.service.js';
import { SyncMonitoringService } from '../services/sync-monitoring.service.js';
import { createHealthRouter } from './health.routes.js';
import { SyncMonitoringController } from '../controllers/sync-monitoring.controller.js';
import { createSyncMonitoringRouter } from './sync-monitoring.routes.js';

export function createApiRouter(dependencies: {
  healthRepository: HealthRepository;
  syncMonitoringRepository?: SyncMonitoringRepository;
  dashboardApiToken?: string;
}): Router {
  const router = Router();
  const healthService = new HealthService(dependencies.healthRepository);
  const healthController = new HealthController(healthService);

  router.use(createHealthRouter(healthController));
  if (dependencies.syncMonitoringRepository) {
    const monitoringService = new SyncMonitoringService(dependencies.syncMonitoringRepository);
    const monitoringController = new SyncMonitoringController(monitoringService);
    router.use(createSyncMonitoringRouter(monitoringController, dependencies.dashboardApiToken));
  }
  return router;
}
