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

import { prisma } from './db/client';
import { triggerShutdown } from './utils/shutdownManager';
import { closeQueueAndRedis } from './queue/index';
import { initWebSocketServer, closeWebSocketServer } from './utils/wsBroadcaster';

// Initialize BullMQ Worker
const worker = initVideoWorker();

const server = app.listen(port, () => {
  console.log(`[Server] Historical Documentary Generator Backend running on http://localhost:${port}`);
  console.log(`[Server] Health check available at http://localhost:${port}/health`);
  console.log(`[Server] Generate API available at POST http://localhost:${port}/api/generate`);
  console.log(`[Server] Static files served at http://localhost:${port}/public/`);
});

// Initialize WebSocket server for real-time status broadcasting
initWebSocketServer(server);

let isShuttingDownProcess = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDownProcess) return;
  isShuttingDownProcess = true;
  console.log(`\n[Server] ${signal} signal received. Initiating graceful shutdown...`);

  // Safety timer: force exit process cleanly if cleanup takes longer than 1.5 seconds
  const forceExitTimeout = setTimeout(() => {
    console.warn('[Server] Shutdown timed out. Forcing process exit.');
    process.exit(0);
  }, 1500);
  forceExitTimeout.unref();

  // 1. Abort active fetch calls & background loops
  triggerShutdown();
  closeWebSocketServer();

  // 2. Stop accepting new HTTP requests
  server.close(() => {
    console.log('[Server] Express HTTP server closed.');
  });

  // 3. Close BullMQ worker & Redis connections
  try {
    await worker.close();
    console.log('[BullMQ Worker] Worker closed cleanly.');
  } catch (err) {
    console.warn('[BullMQ Worker] Error closing worker:', (err as Error).message);
  }

  try {
    await closeQueueAndRedis();
  } catch (err) {
    console.warn('[Redis] Error closing Queue & Redis:', (err as Error).message);
  }

  // 4. Disconnect Prisma DB client
  try {
    await prisma.$disconnect();
    console.log('[Prisma] Database connection closed.');
  } catch (err) {
    console.warn('[Prisma] Error disconnecting Prisma:', (err as Error).message);
  }

  console.log('[Server] Graceful shutdown completed. Exiting process.');
  clearTimeout(forceExitTimeout);
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
