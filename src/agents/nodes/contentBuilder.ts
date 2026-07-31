import { createLLM } from '../../utils/llmFactory';
import { z } from 'zod';
import { GraphStateType, safeGetChapters } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { broadcastAgentStatus } from '../../utils/wsBroadcaster';

export const ChapterSchema = z.object({
  sequenceIndex: z.number().describe('1-based chronological index of the chapter segment'),
  title: z.string().describe('Short evocative historical chapter title'),
  summary: z.string().describe('Brief 1-sentence summary outlining key topic for this chapter'),
  visualConcept: z.string().describe('Concise visual description for artwork generation'),
});

export const DocumentOutlineSchema = z.object({
  chapters: z.array(ChapterSchema).describe('Chronological historical documentary outline'),
});

export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>;

export async function contentBuilderNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  console.log(`[ContentBuilder Agent] Generating dynamic historical chapter outline for: "${state.topic}" (${state.targetDurationMinutes} mins)...`);

  broadcastAgentStatus({
    jobId: state.jobId,
    activeAgent: 'ContentBuilderAgent',
    currentTask: `Generating dynamic chapter outline for "${state.topic}"`,
    progressPercentage: 20,
    status: 'running',
  });

  // Dynamically calculate optimal chapter count based on target runtime pacing (~1 to 1.5 minutes per chapter)
  const targetChapterCount = Math.max(3, Math.min(12, Math.round(state.targetDurationMinutes * 1.2)));

  const researchContext = state.researchData
    ? `Deep Research Findings:\n${state.researchData}`
    : 'No research data provided.';

  const prompt = `You are an executive documentary producer synthesizing research into a dynamic chapter outline.
Topic: "${state.topic}"
Target Runtime: ${state.targetDurationMinutes} minutes.
Target Chapter Count: Exactly ${targetChapterCount} chronological chapters.

${researchContext}

Instructions:
1. Based on the deep research provided above, create a chronological outline of exactly ${targetChapterCount} chapters.
2. For each chapter, provide:
   - sequenceIndex: Starting at 1 up to ${targetChapterCount}.
   - title: Evocative, historical chapter title.
   - summary: Exactly 1-2 sentences outlining the historical sub-topics to cover in this chapter.
   - visualConcept: Concise description of key visual scenes for artwork generation.
3. Keep response concise and focused strictly on the chapter outline JSON schema. Do NOT write full narration scripts here.`;

  try {
    const result = await executeWithRateLimit(
      async (apiKey) => {
        const model = createLLM({
          requireJson: true,
          apiKey: apiKey,
          temperature: 0.5,
          maxOutputTokens: 2000,
        });
        const structuredLlm = model.withStructuredOutput(DocumentOutlineSchema);
        return structuredLlm.invoke(prompt);
      },
      'ContentBuilder',
      state.jobId,
      prompt
    );

    const safeChapters = safeGetChapters(result?.chapters);
    console.log(`[ContentBuilder Agent] Successfully generated ${safeChapters.length} dynamic chapters based on deep research.`);

    return {
      chapters: safeChapters,
      workflowStatus: 'OUTLINE_GENERATED',
    };
  } catch (error) {
    console.error('[ContentBuilder Agent] Error generating dynamic outline:', error);
    return {
      error: `ContentBuilder error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
