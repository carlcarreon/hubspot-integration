import cors from 'cors';
import express, { type Express } from 'express';
import { loadEnvironment, type Environment } from './config/env.js';
import { OrderWebhookController } from './controllers/order-webhook.controller.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import type { HealthRepository } from './repositories/health.repository.js';
import type { OrderRepository } from './repositories/order.repository.js';
import type { SyncMonitoringRepository } from './repositories/sync-monitoring.repository.js';
import type { DealCsvExportService } from './services/deal-csv-export.service.js';
import { createApiRouter } from './routes/index.js';
import { createOrderWebhookRouter } from './routes/order-webhook.routes.js';
import { OrderWebhookService } from './services/order-webhook.service.js';
import { WebhookSignatureService } from './services/webhook-signature.service.js';

type AppDependencies = {
  healthRepository: HealthRepository;
  orderRepository: OrderRepository;
  syncMonitoringRepository?: SyncMonitoringRepository;
  dealCsvExportService?: DealCsvExportService;
};

export function createApp(
  dependencies: AppDependencies,
  environment: Environment = loadEnvironment(),
): Express {
  const app = express();
  const orderWebhookService = new OrderWebhookService(dependencies.orderRepository);
  const orderWebhookController = new OrderWebhookController(orderWebhookService);
  const signatureService = new WebhookSignatureService(environment.WEBHOOK_SIGNING_SECRET);

  app.disable('x-powered-by');
  app.use(cors({ origin: environment.FRONTEND_ORIGIN }));
  // Keep the exact wire bytes available to the signature middleware. This must
  // run before JSON parsing and is deliberately scoped to webhook endpoints.
  app.use('/api/webhooks', express.raw({ type: () => true, limit: '100kb' }));
  app.use('/api/webhooks', createOrderWebhookRouter(orderWebhookController, signatureService));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter({
    ...dependencies,
    dashboardApiToken: environment.DASHBOARD_API_TOKEN,
  }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
