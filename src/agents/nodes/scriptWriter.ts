import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { config } from '../../config/env';

export async function scriptWriterNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const segmentId = state.currentSegmentId;
  console.log(`[ScriptWriter Agent] Generating script for segmentId: ${segmentId}...`);

  if (!segmentId) {
    console.error('[ScriptWriter Agent] Missing currentSegmentId in graph state.');
    return {
      error: 'ScriptWriter error: Missing currentSegmentId in graph state',
      workflowStatus: 'FAILED',
    };
  }

  try {
    // 1. Fetch segment outline from Prisma DB
    const segment = await prisma.videoSegment.findUnique({
      where: { id: segmentId },
    });

    if (!segment) {
      throw new Error(`VideoSegment with ID ${segmentId} not found in database.`);
    }

    // 2. Call Gemini model via Rate Limiter
    const modelName = config.geminiModel;

    const prompt = `You are a master historical documentary narrator and voiceover writer.
Write a compelling, dramatic, human-sounding voiceover script for Chapter ${segment.sequenceIndex}: "${segment.title}".

Documentary Overall Topic: "${state.topic}"
Chapter Title: "${segment.title}"
Chapter Outline/Summary: "${segment.narrationScript || 'Historical context for this chapter.'}"
Visual Style & Imagery Context: "${segment.imagePrompt || 'Archival visuals.'}"

Instructions:
- Write ONLY the spoken voiceover narration text.
- Do NOT include scene cues, bracketed stage directions [like this], or speaker tags.
- Use vivid, engaging, human storytelling language suitable for a high-quality historical documentary.
- Length: approximately 150-250 words.`;

    const response = await executeWithRateLimit(
      async (apiKey) => {
        const model = new ChatGoogleGenerativeAI({
          model: modelName,
          apiKey: apiKey,
          temperature: 0.7,
          maxRetries: 0,
        });
        return model.invoke(prompt);
      },
      `ScriptWriter-${segment.sequenceIndex}`,
      state.jobId,
      prompt
    );

    const fullScriptText = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);

    // 3. Update VideoSegment in Prisma DB with generated script text
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        narrationScript: fullScriptText,
        status: 'SCRIPTED',
      },
    });

    console.log(`[ScriptWriter Agent] Successfully generated script for segment ${segmentId} (${fullScriptText.length} chars).`);

    return {
      workflowStatus: 'SCRIPTED',
    };
  } catch (error) {
    console.error(`[ScriptWriter Agent] Error generating script for segment ${segmentId}:`, error);
    return {
      error: `ScriptWriter error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
