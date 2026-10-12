import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { requestLogger } from './middlewares/requestLogger';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { auditRouter } from './routes/audit';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { documentsRouter } from './routes/documents';
import { healthRouter } from './routes/health';
import { uploadRouter } from './routes/upload';
import { usageRouter } from './routes/usage';

const WEB_DIST =
  process.env.WEB_DIST ?? path.resolve(__dirname, '..', '..', 'web', 'dist');

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', documentsRouter);
  app.use('/api', auditRouter);
  app.use('/api', uploadRouter);
  app.use('/api', usageRouter);
  app.use('/api', chatRouter);

  if (fs.existsSync(WEB_DIST)) {
    app.use(
      express.static(WEB_DIST, {
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
          }
        },
      }),
    );
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
