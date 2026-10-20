import 'dotenv/config';
import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  WEBHOOK_SIGNING_SECRET: optionalString,
  HUBSPOT_ACCESS_TOKEN: optionalString,
  HUBSPOT_PIPELINE_ID: optionalString,
  HUBSPOT_DEAL_STAGE_ID: optionalString,
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
