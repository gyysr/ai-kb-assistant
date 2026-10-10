import express from 'express';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { auditRouter } from './routes/audit';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { documentsRouter } from './routes/documents';
import { healthRouter } from './routes/health';
import { uploadRouter } from './routes/upload';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', documentsRouter);
  app.use('/api', auditRouter);
  app.use('/api', uploadRouter);
  app.use('/api', chatRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
