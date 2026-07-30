import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redisConnection = new Redis({
  host: redisHost,
  port: redisPort,
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

export const VIDEO_GENERATION_QUEUE_NAME = 'video-generation-queue';

export const videoQueue = new Queue(VIDEO_GENERATION_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export async function closeQueueAndRedis(): Promise<void> {
  try {
    await videoQueue.close();
    await redisConnection.quit();
    console.log('[Redis] Queue and Redis connection closed.');
  } catch (err) {
    console.warn('[Redis] Warning closing Redis connection:', (err as Error).message);
  }
}
