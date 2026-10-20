import { Router } from 'express';
import { HealthController } from '../controllers/health.controller.js';
import type { HealthRepository } from '../repositories/health.repository.js';
import type { SyncMonitoringRepository } from '../repositories/sync-monitoring.repository.js';
import { HealthService } from '../services/health.service.js';
import { SyncMonitoringService } from '../services/sync-monitoring.service.js';
import { createHealthRouter } from './health.routes.js';
import { SyncMonitoringController } from '../controllers/sync-monitoring.controller.js';
import { createSyncMonitoringRouter } from './sync-monitoring.routes.js';
import { DealCsvExportController } from '../controllers/deal-csv-export.controller.js';
import type { DealCsvExportService } from '../services/deal-csv-export.service.js';
import { createDealCsvExportRouter } from './deal-csv-export.routes.js';

export function createApiRouter(dependencies: {
  healthRepository: HealthRepository;
  syncMonitoringRepository?: SyncMonitoringRepository;
  dealCsvExportService?: DealCsvExportService;
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
  if (dependencies.dealCsvExportService) {
    const exportController = new DealCsvExportController(dependencies.dealCsvExportService);
    router.use(createDealCsvExportRouter(exportController, dependencies.dashboardApiToken));
  }
  return router;
}
