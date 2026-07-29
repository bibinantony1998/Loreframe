import dotenv from 'dotenv';
dotenv.config();

import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import healthRouter from './api/routes/health';
import generateRouter from './api/routes/generate';
import { initVideoWorker } from './queue/worker';

const app: Express = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Static file serving for generated audio & media assets
app.use('/public', express.static(path.join(process.cwd(), 'public')));

// Routes
app.use('/api', healthRouter);
app.use('/api', generateRouter);
app.use('/', healthRouter); // Mount health check at root /health

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ServerError]', err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Initialize BullMQ Worker
initVideoWorker();

app.listen(port, () => {
  console.log(`[Server] Historical Documentary Generator Backend running on http://localhost:${port}`);
  console.log(`[Server] Health check available at http://localhost:${port}/health`);
  console.log(`[Server] Generate API available at POST http://localhost:${port}/api/generate`);
  console.log(`[Server] Static files served at http://localhost:${port}/public/`);
});
