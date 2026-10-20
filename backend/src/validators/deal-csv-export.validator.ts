import { z } from 'zod';

const exportQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
});

export class DealCsvExportValidationError extends Error {
  constructor() {
    super('The export days value is invalid.');
  }
}

export function parseDealCsvExportQuery(query: unknown): { days: number } {
  const parsed = exportQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new DealCsvExportValidationError();
  }
  return parsed.data;
}
