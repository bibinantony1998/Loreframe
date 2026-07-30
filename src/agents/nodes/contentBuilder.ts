import { createLLM } from '../../utils/llmFactory';
import { z } from 'zod';
import { GraphStateType, safeGetChapters } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { config } from '../../config/env';

export const ChapterSchema = z.object({
  sequenceIndex: z.number().describe('1-based chronological index of the chapter segment'),
  title: z.string().describe('Short evocative historical chapter title'),
  summary: z.string().describe('Brief 1-sentence summary outlining key topic for this chapter'),
  visualConcept: z.string().describe('Concise visual description for artwork generation'),
});

export const DocumentOutlineSchema = z.object({
  chapters: z.array(ChapterSchema).describe('Chronological historical documentary outline (5-8 chapters)'),
});

export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>;

export async function contentBuilderNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  console.log(`[ContentBuilder Agent] Generating lightweight historical outline for: "${state.topic}" (${state.targetDurationMinutes} mins)...`);

  const prompt = `You are a documentary producer creating a high-level chapter outline.
Topic: "${state.topic}"
Target Duration: ${state.targetDurationMinutes} minutes.

Instructions:
1. Generate a lightweight outline of 5 to 8 chronological chapters.
2. For each chapter, provide:
   - sequenceIndex: Starting at 1.
   - title: Short chapter title.
   - summary: Exactly 1 concise sentence summarizing the chapter context.
   - visualConcept: A concise 1-sentence description of the visual style.
3. CRITICAL: Keep response ultra-brief. Do NOT generate full narration script text or long essays. Narration scripts will be generated separately per chapter in downstream processing.`;

  try {
    const result = await executeWithRateLimit(
      async (apiKey) => {
        const model = createLLM({
          requireJson: true,
          apiKey: apiKey,
          temperature: 0.5,
          maxOutputTokens: 1000,
        });
        const structuredLlm = model.withStructuredOutput(DocumentOutlineSchema);
        return structuredLlm.invoke(prompt);
      },
      'ContentBuilder',
      state.jobId,
      prompt
    );

    const safeChapters = safeGetChapters(result?.chapters);
    console.log(`[ContentBuilder Agent] Successfully generated ${safeChapters.length} chapters.`);

    return {
      chapters: safeChapters,
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
