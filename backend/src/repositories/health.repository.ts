export interface HealthRepository {
  checkDatabase(): Promise<void>;
}

export class PrismaHealthRepository implements HealthRepository {
  constructor(private readonly database: { $queryRawUnsafe(query: string): Promise<unknown> }) {}

  async checkDatabase(): Promise<void> {
    await this.database.$queryRawUnsafe('SELECT 1');
  }
}
