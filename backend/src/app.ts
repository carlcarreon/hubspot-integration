import cors from 'cors';
import express, { type Express } from 'express';
import { loadEnvironment, type Environment } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { PrismaHealthRepository } from './repositories/health.repository.js';
import { createApiRouter } from './routes/index.js';

type AppDependencies = {
  healthRepository: PrismaHealthRepository;
};

export function createApp(
  dependencies: AppDependencies,
  environment: Environment = loadEnvironment(),
): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: environment.FRONTEND_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter(dependencies));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
