import { Router } from 'express';
import type { DealCsvExportController } from '../controllers/deal-csv-export.controller.js';
import { requireDashboardAuthentication } from '../middleware/dashboard-authentication.js';

export function createDealCsvExportRouter(
  controller: DealCsvExportController,
  dashboardApiToken: string | undefined,
): Router {
  const router = Router();
  router.use(requireDashboardAuthentication(dashboardApiToken));
  router.get('/exports/deals', controller.download);
  return router;
}
