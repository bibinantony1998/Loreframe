import { Worker, Job } from 'bullmq';
import { redisConnection, VIDEO_GENERATION_QUEUE_NAME } from './index';
import { executeDocumentaryWorkflow } from '../agents/supervisor';

export interface VideoJobPayload {
  jobId: string;
  topic: string;
  durationMinutes: number;
}

export function initVideoWorker(): Worker<VideoJobPayload> {
  console.log(`[BullMQ Worker] Initializing worker for queue: "${VIDEO_GENERATION_QUEUE_NAME}"...`);

  const worker = new Worker<VideoJobPayload>(
    VIDEO_GENERATION_QUEUE_NAME,
    async (job: Job<VideoJobPayload>) => {
      const { jobId, topic, durationMinutes } = job.data;
      console.log(`[BullMQ Worker] Processing Job ID: ${jobId} (Name: ${job.name}, Topic: "${topic}")`);

      const result = await executeDocumentaryWorkflow({
        jobId,
        topic,
        targetDurationMinutes: durationMinutes,
      });

      if (result.error || result.workflowStatus === 'FAILED') {
        throw new Error(result.error || 'Workflow execution failed');
      }

      return { jobId, status: result.workflowStatus, chapterCount: result.chapters.length };
    },
    {
      connection: redisConnection,
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[BullMQ Worker] Job ${job.id} (VideoJob: ${job.data.jobId}) completed successfully.`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[BullMQ Worker] Job ${job?.id} (VideoJob: ${job?.data?.jobId}) failed with error:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[BullMQ Worker] Worker connection error:', err);
  });

  return worker;
}
