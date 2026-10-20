import type { HealthRepository } from '../repositories/health.repository.js';

export type HealthStatus = {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
};

export class HealthService {
  constructor(private readonly healthRepository: HealthRepository) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.healthRepository.checkDatabase();
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
