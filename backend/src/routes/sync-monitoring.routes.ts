import { Router } from 'express';
import type { SyncMonitoringController } from '../controllers/sync-monitoring.controller.js';
import { requireDashboardAuthentication } from '../middleware/dashboard-authentication.js';

export function createSyncMonitoringRouter(
  controller: SyncMonitoringController,
  dashboardApiToken: string | undefined,
): Router {
  const router = Router();
  router.use(requireDashboardAuthentication(dashboardApiToken));
  router.get('/syncs', controller.list);
  router.get('/syncs/stats', controller.stats);
  router.get('/syncs/:id', controller.detail);
  router.get('/orders', controller.orders);
  router.get('/orders/failed', controller.failedOrders);
  router.get('/orders/:orderId/attempts', controller.orderAttempts);
  router.post('/orders/:orderId/retry', controller.retry);
  return router;
}
