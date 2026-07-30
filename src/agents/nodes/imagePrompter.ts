import { createLLM } from '../../utils/llmFactory';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { config } from '../../config/env';

export async function imagePrompterNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const segmentId = state.currentSegmentId;
  console.log(`[ImagePrompter Agent] Crafting visual prompt for segmentId: ${segmentId}...`);

  if (!segmentId) {
    console.error('[ImagePrompter Agent] Missing currentSegmentId in state.');
    return {
      error: 'ImagePrompter error: Missing currentSegmentId in state',
      workflowStatus: 'FAILED',
    };
  }

  try {
    // 1. Fetch segment from Prisma DB
    const segment = await prisma.videoSegment.findUnique({
      where: { id: segmentId },
    });

    if (!segment) {
      throw new Error(`VideoSegment ${segmentId} not found in database.`);
    }

    // 2. Call LLM via Factory & Rate Limiter
    const prompt = `You are a master visual director and AI prompt engineer for high-end historical documentaries.
Craft a highly detailed, cinematic image generation prompt for Chapter ${segment.sequenceIndex}: "${segment.title}".

Documentary Topic: "${state.topic}"
Chapter Title: "${segment.title}"
Voiceover Narration Script: "${segment.narrationScript || ''}"
Initial Visual Concept: "${segment.imagePrompt || 'Historical scene'}"

Instructions:
- Write a single, highly descriptive prompt optimized for AI image generators (e.g. Imagen 3, Midjourney, DALL-E 3).
- Focus on photorealism, historical accuracy, 16:9 widescreen composition, cinematic volumetric lighting, 8k resolution, and dramatic atmospheric depth.
- Do NOT include markdown, commentary, or quotes. Output ONLY the raw image generation prompt string.`;

    const response = await executeWithRateLimit(
      async (apiKey) => {
        const model = createLLM({
          requireJson: false,
          apiKey: apiKey,
          temperature: 0.7,
        });
        return model.invoke(prompt);
      },
      `ImagePrompter-${segment.sequenceIndex}`,
      state.jobId,
      prompt
    );

    const detailedPrompt = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);

    // 3. Update VideoSegment in Prisma DB
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        imagePrompt: detailedPrompt,
      },
    });

    console.log(`[ImagePrompter Agent] Created visual prompt for segment ${segmentId}: "${detailedPrompt.slice(0, 60)}..."`);

    return {
      workflowStatus: 'IMAGE_PROMPTED',
    };
  } catch (error) {
    console.error(`[ImagePrompter Agent] Error generating image prompt for segment ${segmentId}:`, error);
    return {
      error: `ImagePrompter error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
