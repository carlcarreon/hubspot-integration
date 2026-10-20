import { prisma } from '../config/database.js';
import { loadEnvironment, requireHubSpotEnvironment } from '../config/env.js';
import { PrismaSyncJobRepository } from '../repositories/sync-job.repository.js';
import { HubSpotHttpClient } from '../services/hubspot-client.service.js';
import { HubSpotSyncService } from '../services/hubspot-sync.service.js';
import { SyncJobWorker } from './sync-job-worker.js';

const environment = loadEnvironment();
const hubSpotEnvironment = requireHubSpotEnvironment(environment);
const syncJobRepository = new PrismaSyncJobRepository(prisma);
const hubSpotClient = new HubSpotHttpClient(hubSpotEnvironment.HUBSPOT_ACCESS_TOKEN);
const hubSpotSyncService = new HubSpotSyncService(hubSpotClient, syncJobRepository, {
  pipelineId: hubSpotEnvironment.HUBSPOT_PIPELINE_ID,
  dealStageId: hubSpotEnvironment.HUBSPOT_DEAL_STAGE_ID,
});
const worker = new SyncJobWorker(
  syncJobRepository,
  hubSpotSyncService,
  environment.WORKER_LEASE_SECONDS * 1_000,
);

let stopping = false;

async function main(): Promise<void> {
  console.info('HubSpot sync worker starting; verifying property configuration.');
  await worker.run(environment.WORKER_POLL_INTERVAL_MS, () => stopping);
}

function shutdown(signal: string): void {
  stopping = true;
  console.info(`Received ${signal}; stopping worker.`);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Worker startup failed.';
  console.error('HubSpot sync worker could not start.', { error: message });
  await prisma.$disconnect();
  process.exitCode = 1;
});
