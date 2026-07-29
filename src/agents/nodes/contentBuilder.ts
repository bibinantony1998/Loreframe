import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { config } from '../../config/env';

export const ChapterSchema = z.object({
  sequenceIndex: z.number().describe('1-based chronological index of the chapter segment'),
  title: z.string().describe('Engaging historical chapter title'),
  summary: z.string().describe('Comprehensive historical narration outline and key details for this chapter'),
  visualConcept: z.string().describe('Detailed visual aesthetic, atmospheric tone, and archival artwork visual concept'),
});

export const DocumentOutlineSchema = z.object({
  chapters: z.array(ChapterSchema).describe('Chronological historical documentary chapters'),
});

export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>;

export async function contentBuilderNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  console.log(`[ContentBuilder Agent] Generating historical outline for: "${state.topic}" (${state.targetDurationMinutes} mins)...`);

  const modelName = config.geminiModel;
  const apiKey = config.googleApiKey;

  const model = new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey: apiKey,
    temperature: 0.7,
  });

  const structuredLlm = model.withStructuredOutput(DocumentOutlineSchema);

  const prompt = `You are a world-class documentary producer and historian creating content for a long-form historical video.
Topic: "${state.topic}"
Target Video Duration: ${state.targetDurationMinutes} minutes.

Instructions:
1. Break down the historical narrative into distinct, chronologically ordered chapters.
2. Ensure sequenceIndex starts at 1 and increases sequentially.
3. For each chapter, generate:
   - title: An evocative chapter title.
   - summary: Detailed historical narrative summary covering context, key figures, and pivotal moments.
   - visualConcept: Atmospheric visual description, lighting, camera angles, and artwork themes for visual generation.`;

  try {
    const result = await executeWithRateLimit(
      () => structuredLlm.invoke(prompt),
      'ContentBuilder'
    );

    console.log(`[ContentBuilder Agent] Successfully generated ${result.chapters.length} chapters.`);
    return {
      chapters: result.chapters,
      workflowStatus: 'OUTLINE_GENERATED',
    };
  } catch (error) {
    console.error('[ContentBuilder Agent] Error generating structured outline:', error);
    return {
      error: `ContentBuilder error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
