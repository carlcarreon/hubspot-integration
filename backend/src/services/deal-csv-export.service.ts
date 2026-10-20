import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const serviceDirectory = dirname(fileURLToPath(import.meta.url));
const exporterScriptPath = resolve(serviceDirectory, '../../../scripts/export_deals.py');

export type PythonExecutionOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
};

export type PythonCommandRunner = (
  executable: string,
  arguments_: string[],
  options: PythonExecutionOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type PreparedCsvExport = {
  filePath: string;
  filename: string;
  cleanup(): Promise<void>;
};

export interface DealCsvExportService {
  exportLastCreatedDeals(days: number): Promise<PreparedCsvExport>;
}

export class CsvExportBusyError extends Error {
  constructor() {
    super('Another CSV export is already in progress. Please try again shortly.');
  }
}

export class CsvExportNotConfiguredError extends Error {
  constructor() {
    super('CSV export is unavailable because HubSpot access is not configured.');
  }
}

export class CsvExportExecutionError extends Error {
  constructor(message = 'The CSV export could not be completed.') {
    super(message);
  }
}

export class CsvExportTimeoutError extends CsvExportExecutionError {
  constructor() {
    super('The CSV export timed out. Please try again later.');
  }
}

export type DealCsvExportConfiguration = {
  pythonExecutable: string;
  hubSpotAccessToken?: string;
  timeoutMs: number;
  maxConcurrentExports: number;
};

export class PythonDealCsvExportService implements DealCsvExportService {
  private activeExports = 0;

  constructor(
    private readonly configuration: DealCsvExportConfiguration,
    private readonly runPython: PythonCommandRunner = defaultPythonCommandRunner,
  ) {}

  async exportLastCreatedDeals(days: number): Promise<PreparedCsvExport> {
    if (!this.configuration.hubSpotAccessToken) {
      throw new CsvExportNotConfiguredError();
    }
    if (this.activeExports >= this.configuration.maxConcurrentExports) {
      throw new CsvExportBusyError();
    }

    this.activeExports += 1;
    let temporaryDirectory: string | undefined;
    try {
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'hubspot-deals-export-'));
      const filePath = join(temporaryDirectory, `deals-${randomUUID()}.csv`);
      await this.runPython(
        this.configuration.pythonExecutable,
        [exporterScriptPath, '--days', String(days), '--output', filePath],
        {
          cwd: resolve(serviceDirectory, '../../..'),
          env: pythonEnvironment(this.configuration.hubSpotAccessToken),
          timeout: this.configuration.timeoutMs,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        },
      );
      const output = await stat(filePath);
      if (!output.isFile()) {
        throw new CsvExportExecutionError();
      }

      const directoryToClean = temporaryDirectory;
      temporaryDirectory = undefined;
      return {
        filePath,
        filename: `hubspot_deals_last_${days}_days.csv`,
        cleanup: () => rm(directoryToClean, { recursive: true, force: true }),
      };
    } catch (error) {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
      if (error instanceof CsvExportExecutionError) {
        throw error;
      }
      throw toSafeExportError(error);
    } finally {
      this.activeExports -= 1;
    }
  }
}

async function defaultPythonCommandRunner(
  executable: string,
  arguments_: string[],
  options: PythonExecutionOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(executable, arguments_, options);
}

function pythonEnvironment(accessToken: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
    HUBSPOT_ACCESS_TOKEN: accessToken,
    PYTHONIOENCODING: 'utf-8',
  };
}

function toSafeExportError(error: unknown): CsvExportExecutionError {
  if (isTimeoutError(error)) {
    return new CsvExportTimeoutError();
  }
  const stderr = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
    ? error.stderr
    : '';
  const message = sanitizeProcessMessage(stderr);
  return new CsvExportExecutionError(message || 'The CSV export could not be completed.');
}

function isTimeoutError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (('killed' in error && error.killed === true) || ('code' in error && error.code === 'ETIMEDOUT'));
}

function sanitizeProcessMessage(value: string): string {
  const match = /Export failed:\s*([^\r\n]+)/.exec(value);
  const message = match?.[1] ?? '';
  return message
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 500);
}
