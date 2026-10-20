import { createApp } from './app.js';
import { prisma } from './config/database.js';
import { loadEnvironment } from './config/env.js';
import { PrismaHealthRepository } from './repositories/health.repository.js';
import { PrismaOrderRepository } from './repositories/order.repository.js';
import { PrismaSyncMonitoringRepository } from './repositories/sync-monitoring.repository.js';
import { PythonDealCsvExportService } from './services/deal-csv-export.service.js';

const environment = loadEnvironment();
const app = createApp(
  {
    healthRepository: new PrismaHealthRepository(prisma),
    orderRepository: new PrismaOrderRepository(prisma, environment.WORKER_MAX_ATTEMPTS),
    syncMonitoringRepository: new PrismaSyncMonitoringRepository(prisma, environment.WORKER_MAX_ATTEMPTS),
    dealCsvExportService: new PythonDealCsvExportService({
      pythonExecutable: environment.PYTHON_EXECUTABLE,
      hubSpotAccessToken: environment.HUBSPOT_ACCESS_TOKEN,
      timeoutMs: environment.EXPORT_TIMEOUT_MS,
      maxConcurrentExports: environment.EXPORT_MAX_CONCURRENT,
    }),
  },
  environment,
);

const server = app.listen(environment.API_PORT, () => {
  console.info(`API listening on http://localhost:${environment.API_PORT}`);
});

async function shutdown(signal: string): Promise<void> {
  console.info(`Received ${signal}; shutting down.`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
