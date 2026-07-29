import { Router, Request, Response } from 'express';
import { prisma } from '../../db/client';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = `error: ${(error as Error).message}`;
  }

  res.json({
    status: 'ok',
    service: 'historical-documentary-generator',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: dbStatus,
  });
});

export default router;
