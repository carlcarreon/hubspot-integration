import type { NextFunction, Request, Response } from 'express';
import {
  CsvExportBusyError,
  CsvExportExecutionError,
  CsvExportNotConfiguredError,
  CsvExportTimeoutError,
  type DealCsvExportService,
  type PreparedCsvExport,
} from '../services/deal-csv-export.service.js';
import {
  DealCsvExportValidationError,
  parseDealCsvExportQuery,
} from '../validators/deal-csv-export.validator.js';

export class DealCsvExportController {
  constructor(private readonly service: DealCsvExportService) {}

  download = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    let preparedExport: PreparedCsvExport | undefined;
    try {
      const { days } = parseDealCsvExportQuery(request.query);
      preparedExport = await this.service.exportLastCreatedDeals(days);
      let cleaned = false;
      const cleanup = async (): Promise<void> => {
        if (!cleaned) {
          cleaned = true;
          await preparedExport?.cleanup();
        }
      };
      response.once('close', () => void cleanup());
      response.type('text/csv; charset=utf-8');
      response.download(preparedExport.filePath, preparedExport.filename, (error) => {
        void cleanup().then(() => {
          if (error && !response.headersSent) {
            next(error);
          }
        });
      });
    } catch (error) {
      await preparedExport?.cleanup();
      if (error instanceof DealCsvExportValidationError) {
        response.status(400).json({ error: { code: 'INVALID_EXPORT_DAYS', message: 'Days must be an integer between 1 and 30.' } });
        return;
      }
      if (error instanceof CsvExportNotConfiguredError) {
        response.status(503).json({ error: { code: 'EXPORT_NOT_CONFIGURED', message: error.message } });
        return;
      }
      if (error instanceof CsvExportBusyError) {
        response.status(429).json({ error: { code: 'EXPORT_BUSY', message: error.message } });
        return;
      }
      if (error instanceof CsvExportTimeoutError) {
        response.status(504).json({ error: { code: 'EXPORT_TIMEOUT', message: error.message } });
        return;
      }
      if (error instanceof CsvExportExecutionError) {
        response.status(502).json({ error: { code: 'EXPORT_FAILED', message: error.message } });
        return;
      }
      next(error);
    }
  };
}
