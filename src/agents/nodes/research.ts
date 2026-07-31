import { createLLM } from '../../utils/llmFactory';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { broadcastAgentStatus } from '../../utils/wsBroadcaster';

export async function researchNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  console.log(`[Research Agent] Conducting deep historical research on topic: "${state.topic}"...`);

  broadcastAgentStatus({
    jobId: state.jobId,
    activeAgent: 'ResearchAgent',
    currentTask: `Conducting deep historical research on "${state.topic}"`,
    progressPercentage: 10,
    status: 'running',
  });

  const prompt = `You are a chief historical researcher for a top-tier documentary production studio.
Conduct a comprehensive, deep-dive historical research analysis on the topic: "${state.topic}".

Instructions:
1. Provide a detailed historical breakdown including:
   - Historical Context & Background: Key eras, setting, geographical context.
   - Chronological Timeline & Major Phases: Key turning points and chronological progression.
   - Important Historical Figures & Leaders: Key individuals and their motivations.
   - Pivotal Conflicts / Events / Decisions: Major battles, socio-economic crises, political shifts.
   - Historical Impact & Legacy: Short-term consequences and long-term historical significance.
2. Format as clean, dense, highly structured text with clear headings.
3. Length: Approximately 400-600 words of thorough historical research.`;

  try {
    const response = await executeWithRateLimit(
      async (apiKey) => {
        const model = createLLM({
          requireJson: false,
          apiKey: apiKey,
          temperature: 0.5,
        });
        return model.invoke(prompt);
      },
      'ResearchAgent',
      state.jobId,
      prompt
    );

    const researchText = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);
    console.log(`[Research Agent] Deep research completed for "${state.topic}" (${researchText.length} chars).`);

    return {
      researchData: researchText,
      workflowStatus: 'RESEARCH_COMPLETED',
    };
  } catch (error) {
    console.error('[Research Agent] Error conducting research:', error);
    return {
      error: `Research error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
