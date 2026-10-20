import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const configurationDirectory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(configurationDirectory, '../../../.env'), quiet: true });

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  DASHBOARD_API_TOKEN: optionalString,
  HUBSPOT_ACCESS_TOKEN: optionalString,
  HUBSPOT_PIPELINE_ID: optionalString,
  HUBSPOT_DEAL_STAGE_ID: optionalString,
  PYTHON_EXECUTABLE: z.string().min(1).default('python3.11'),
  EXPORT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(90_000),
  EXPORT_MAX_CONCURRENT: z.coerce.number().int().min(1).max(5).default(1),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(25).default(8),
  WORKER_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(100).max(3_600_000).default(1_000),
  WORKER_RETRY_MAX_DELAY_MS: z.coerce.number().int().min(100).max(3_600_000).default(60_000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = environmentSchema.safeParse(input);

  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }

  return parsed.data;
}

export type HubSpotEnvironment = Required<Pick<Environment,
  'HUBSPOT_ACCESS_TOKEN' | 'HUBSPOT_PIPELINE_ID' | 'HUBSPOT_DEAL_STAGE_ID'
>>;

export function requireHubSpotEnvironment(environment: Environment): HubSpotEnvironment {
  const missing = [
    'HUBSPOT_ACCESS_TOKEN',
    'HUBSPOT_PIPELINE_ID',
    'HUBSPOT_DEAL_STAGE_ID',
  ].filter((key) => !environment[key as keyof HubSpotEnvironment]);

  if (missing.length > 0) {
    throw new Error(`Worker configuration is incomplete: ${missing.join(', ')}.`);
  }

  return {
    HUBSPOT_ACCESS_TOKEN: environment.HUBSPOT_ACCESS_TOKEN!,
    HUBSPOT_PIPELINE_ID: environment.HUBSPOT_PIPELINE_ID!,
    HUBSPOT_DEAL_STAGE_ID: environment.HUBSPOT_DEAL_STAGE_ID!,
  };
}
