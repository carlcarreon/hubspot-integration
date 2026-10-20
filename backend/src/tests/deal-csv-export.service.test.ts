import { access, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  CsvExportBusyError,
  CsvExportExecutionError,
  CsvExportTimeoutError,
  PythonDealCsvExportService,
  type PythonCommandRunner,
} from '../services/deal-csv-export.service.js';

function runnerThatWritesCsv(): PythonCommandRunner {
  return async (_executable, arguments_, options) => {
    const outputPath = arguments_[arguments_.indexOf('--output') + 1];
    expect(arguments_).toContain('--days');
    expect(options.env.HUBSPOT_ACCESS_TOKEN).toBe('test-hubspot-token');
    await writeFile(outputPath, 'Deal ID\n1\n', 'utf8');
    return { stdout: '', stderr: '' };
  };
}

function service(runner: PythonCommandRunner) {
  return new PythonDealCsvExportService({
    pythonExecutable: '/opt/python/bin/python3.11',
    hubSpotAccessToken: 'test-hubspot-token',
    timeoutMs: 1_000,
    maxConcurrentExports: 1,
  }, runner);
}

describe('PythonDealCsvExportService', () => {
  it('runs the standalone exporter with explicit arguments and cleans its isolated output', async () => {
    const result = await service(runnerThatWritesCsv()).exportLastCreatedDeals(7);

    await expect(readFile(result.filePath, 'utf8')).resolves.toBe('Deal ID\n1\n');
    expect(result.filename).toBe('hubspot_deals_last_7_days.csv');
    await result.cleanup();
    await expect(access(result.filePath)).rejects.toThrow();
  });

  it('converts a timed-out Python process into a safe timeout error', async () => {
    const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true });
    await expect(service(async () => { throw timeout; }).exportLastCreatedDeals(7)).rejects.toBeInstanceOf(CsvExportTimeoutError);
  });

  it('redacts child-process diagnostics and removes temporary output after failure', async () => {
    const failure = Object.assign(new Error('failed'), {
      stderr: 'Export failed: Bearer test-hubspot-token was rejected\n',
    });
    let outputPath = '';
    const failingRunner: PythonCommandRunner = async (_executable, arguments_) => {
      outputPath = arguments_[arguments_.indexOf('--output') + 1];
      await writeFile(outputPath, 'partial CSV', 'utf8');
      throw failure;
    };
    await expect(service(failingRunner).exportLastCreatedDeals(7)).rejects.toMatchObject({
      message: 'Bearer [redacted] was rejected',
    } satisfies Partial<CsvExportExecutionError>);
    await expect(access(outputPath)).rejects.toThrow();
  });

  it('bounds simultaneous subprocess execution', async () => {
    let complete: ((value: { stdout: string; stderr: string }) => void) | undefined;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const blockingRunner: PythonCommandRunner = async (_executable, arguments_) => {
      const outputPath = arguments_[arguments_.indexOf('--output') + 1];
      await writeFile(outputPath, 'Deal ID\n1\n', 'utf8');
      started?.();
      return new Promise((resolve) => { complete = resolve; });
    };
    const exporter = service(blockingRunner);
    const first = exporter.exportLastCreatedDeals(7);
    await startedPromise;

    await expect(exporter.exportLastCreatedDeals(7)).rejects.toBeInstanceOf(CsvExportBusyError);
    complete?.({ stdout: '', stderr: '' });
    const result = await first;
    await result.cleanup();
  });
});
