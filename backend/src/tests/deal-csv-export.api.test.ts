import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { Environment } from '../config/env.js';
import { PrismaHealthRepository } from '../repositories/health.repository.js';
import type { OrderRepository } from '../repositories/order.repository.js';
import {
  CsvExportExecutionError,
  CsvExportTimeoutError,
  type DealCsvExportService,
} from '../services/deal-csv-export.service.js';

const environment: Environment = {
  NODE_ENV: 'test', API_PORT: 3000,
  DATABASE_URL: 'postgresql://hubspot:hubspot@localhost:5432/hubspot_order_sync',
  FRONTEND_ORIGIN: 'http://localhost:5173', WEBHOOK_SIGNING_SECRET: 'test-webhook-signing-secret',
  DASHBOARD_API_TOKEN: 'dashboard-test-token', HUBSPOT_ACCESS_TOKEN: undefined,
  HUBSPOT_PIPELINE_ID: undefined, HUBSPOT_DEAL_STAGE_ID: undefined,
  PYTHON_EXECUTABLE: 'python3.11', EXPORT_TIMEOUT_MS: 1_000, EXPORT_MAX_CONCURRENT: 1,
  WORKER_POLL_INTERVAL_MS: 1_000, WORKER_LEASE_SECONDS: 300, WORKER_MAX_ATTEMPTS: 8,
  WORKER_RETRY_BASE_DELAY_MS: 1_000, WORKER_RETRY_MAX_DELAY_MS: 60_000,
};

const unusedOrderRepository: OrderRepository = {
  async createOrFindWithInitialJob() { throw new Error('Not used by CSV export tests.'); },
};
const authorization = { Authorization: `Bearer ${environment.DASHBOARD_API_TOKEN}` };

async function successfulExportService(): Promise<DealCsvExportService> {
  const directory = await mkdtemp(join(tmpdir(), 'deal-csv-api-test-'));
  const filePath = join(directory, 'deals.csv');
  await writeFile(filePath, 'Deal ID,Deal Name\n1,Example\n', 'utf8');
  return {
    async exportLastCreatedDeals(days) {
      return {
        filePath,
        filename: `hubspot_deals_last_${days}_days.csv`,
        cleanup: async () => rm(directory, { recursive: true, force: true }),
      };
    },
  };
}

function createTestApp(exportService: DealCsvExportService) {
  const healthRepository = new PrismaHealthRepository({ $queryRawUnsafe: async () => undefined });
  return createApp({ healthRepository, orderRepository: unusedOrderRepository, dealCsvExportService: exportService }, environment);
}

describe('GET /api/exports/deals', () => {
  it('requires dashboard authentication and validates days before starting Python', async () => {
    let calls = 0;
    const exportService: DealCsvExportService = { async exportLastCreatedDeals() { calls += 1; throw new Error('not reached'); } };
    const app = createTestApp(exportService);

    await request(app).get('/api/exports/deals').expect(401);
    await request(app).get('/api/exports/deals?days=0').set(authorization).expect(400).expect({
      error: { code: 'INVALID_EXPORT_DAYS', message: 'Days must be an integer between 1 and 30.' },
    });
    await request(app).get('/api/exports/deals?days=1.5').set(authorization).expect(400);
    expect(calls).toBe(0);
  });

  it('downloads a safe CSV attachment using the default seven-day window', async () => {
    const app = createTestApp(await successfulExportService());
    const response = await request(app).get('/api/exports/deals').set(authorization).expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename=hubspot_deals_last_7_days.csv');
    expect(response.text).toBe('Deal ID,Deal Name\n1,Example\n');
  });

  it('returns safe failure and timeout responses from the Python exporter', async () => {
    const failed: DealCsvExportService = { async exportLastCreatedDeals() { throw new CsvExportExecutionError('Export failed safely.'); } };
    await request(createTestApp(failed)).get('/api/exports/deals').set(authorization).expect(502).expect({
      error: { code: 'EXPORT_FAILED', message: 'Export failed safely.' },
    });
    const timedOut: DealCsvExportService = { async exportLastCreatedDeals() { throw new CsvExportTimeoutError(); } };
    await request(createTestApp(timedOut)).get('/api/exports/deals').set(authorization).expect(504).expect({
      error: { code: 'EXPORT_TIMEOUT', message: 'The CSV export timed out. Please try again later.' },
    });
  });
});
