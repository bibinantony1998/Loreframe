import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { videoQueue } from '../../queue';

const router = Router();

const GenerateRequestSchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters long'),
  durationMinutes: z.number().optional().default(5),
});

// POST /api/generate
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = GenerateRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { topic, durationMinutes } = parseResult.data;

    // 1. Create VideoJob record in Prisma DB
    const videoJob = await prisma.videoJob.create({
      data: {
        topic,
        targetLengthMinutes: durationMinutes,
        status: 'PENDING',
      },
    });

    // 2. Add job to BullMQ worker queue
    try {
      await videoQueue.add('generate-video', {
        jobId: videoJob.id,
        topic: videoJob.topic,
        durationMinutes: videoJob.targetLengthMinutes,
      });
    } catch (queueError) {
      console.warn('[API /generate] Redis/Queue warning:', (queueError as Error).message);
    }

    // 3. Return immediate response with jobId
    res.status(202).json({
      jobId: videoJob.id,
      topic: videoJob.topic,
      targetLengthMinutes: videoJob.targetLengthMinutes,
      status: videoJob.status,
      message: 'Video generation job successfully created and queued.',
      createdAt: videoJob.createdAt,
    });
  } catch (error) {
    console.error('[API /generate] Server error creating video job:', error);
    res.status(500).json({ error: 'Internal Server Error', message: (error as Error).message });
  }
});

// GET /api/status/:jobId (Progress & Status polling endpoint)
router.get('/status/:jobId', async (req: Request, res: Response): Promise<void> => {
  try {
    const jobId = req.params.jobId as string;
    const videoJob = await prisma.videoJob.findUnique({
      where: { id: jobId },
      include: {
        segments: {
          orderBy: { sequenceIndex: 'asc' },
          select: {
            id: true,
            sequenceIndex: true,
            title: true,
            status: true,
            audioUrl: true,
            imageUrl: true,
          },
        },
      },
    });

    if (!videoJob) {
      res.status(404).json({ error: 'VideoJob not found' });
      return;
    }

    let videoUrl = null;
    if (videoJob.metadata) {
      try {
        const parsed = JSON.parse(videoJob.metadata);
        videoUrl = parsed.videoUrl || null;
      } catch (e) {
        // ignore parse error
      }
    }

    res.json({
      jobId: videoJob.id,
      topic: videoJob.topic,
      targetLengthMinutes: videoJob.targetLengthMinutes,
      status: videoJob.status,
      error: videoJob.error,
      videoUrl,
      segmentCount: videoJob.segments.length,
      segments: videoJob.segments,
      createdAt: videoJob.createdAt,
      updatedAt: videoJob.updatedAt,
    });
  } catch (error) {
    console.error('[API /status/:jobId] Error fetching job status:', error);
    res.status(500).json({ error: 'Internal Server Error', message: (error as Error).message });
  }
});

// GET /api/jobs/:id (Detailed job overview)
router.get('/jobs/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const videoJob = await prisma.videoJob.findUnique({
      where: { id },
      include: {
        segments: {
          orderBy: { sequenceIndex: 'asc' },
        },
      },
    });

    if (!videoJob) {
      res.status(404).json({ error: 'VideoJob not found' });
      return;
    }

    res.json(videoJob);
  } catch (error) {
    console.error('[API /jobs/:id] Error fetching job:', error);
    res.status(500).json({ error: 'Internal Server Error', message: (error as Error).message });
  }
});

export default router;
