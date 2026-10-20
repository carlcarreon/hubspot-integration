import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadEnvironment } from './env.js';

const environment = loadEnvironment();
const adapter = new PrismaPg({ connectionString: environment.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
