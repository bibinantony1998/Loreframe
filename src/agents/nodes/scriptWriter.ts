import { createLLM } from '../../utils/llmFactory';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { broadcastAgentStatus } from '../../utils/wsBroadcaster';

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

    broadcastAgentStatus({
      jobId: state.jobId,
      activeAgent: 'ScriptWriterAgent',
      currentTask: `Writing sub-topic narration script for Chapter ${segment.sequenceIndex}: "${segment.title || ''}"`,
      chapterIndex: segment.sequenceIndex,
      totalChapters: state.chapters.length || 5,
      progressPercentage: Math.min(30 + segment.sequenceIndex * 5, 55),
      status: 'running',
    });

    // 2. Granular Sub-Topic Chunking: Break chapter into 3 distinct narrative sub-chunks
    const subTopics = [
      {
        name: 'Historical Context & Setup',
        focus: 'Set the scene, introduce the historical setting, geographical context, and background events leading up to this chapter.',
      },
      {
        name: 'Pivotal Conflict & Action',
        focus: 'Detail the primary historical decision, major crisis, central figure action, or pivotal turning point in this chapter.',
      },
      {
        name: 'Aftermath & Significance',
        focus: 'Explore the immediate consequences, human reaction, and lasting historical legacy of this chapter.',
      },
    ];

    console.log(
      `[ScriptWriter Agent] Chapter ${segment.sequenceIndex} ("${segment.title}"): Executing 3-step sub-topic script chunking...`
    );

    const scriptChunks: string[] = [];

    for (let chunkIndex = 0; chunkIndex < subTopics.length; chunkIndex++) {
      const sub = subTopics[chunkIndex];
      const chunkPrompt = `You are a master historical documentary narrator and voiceover writer.
Write Part ${chunkIndex + 1} of 3 (${sub.name}) for Chapter ${segment.sequenceIndex}: "${segment.title}".

Documentary Overall Topic: "${state.topic}"
Chapter Title: "${segment.title}"
Chapter Summary: "${segment.narrationScript || 'Historical context for this chapter.'}"
${state.researchData ? `Research Reference:\n${state.researchData.slice(0, 500)}...` : ''}

Sub-Topic Focus (Part ${chunkIndex + 1}/3): ${sub.focus}

Instructions:
- Write ONLY the spoken voiceover narration text for this specific section (~60-90 words).
- Do NOT include stage directions, bracketed cues, titles, or speaker tags.
- Ensure narrative flow connects smoothly to previous parts.
- Use vivid, engaging, human storytelling language for a documentary.`;

      const response = await executeWithRateLimit(
        async (apiKey) => {
          const model = createLLM({
            requireJson: false,
            apiKey: apiKey,
            temperature: 0.7,
          });
          return model.invoke(chunkPrompt);
        },
        `ScriptWriter-Ch${segment.sequenceIndex}-Part${chunkIndex + 1}`,
        state.jobId,
        chunkPrompt
      );

      const chunkText = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);
      scriptChunks.push(chunkText);
    }

    // 3. Stitch sub-topic script chunks together seamlessly
    const fullScriptText = scriptChunks.join('\n\n');

    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        narrationScript: fullScriptText,
        status: 'SCRIPTED',
      },
    });

    console.log(
      `[ScriptWriter Agent] Successfully generated and stitched 3 sub-topic script chunks for segment ${segmentId} (${fullScriptText.length} chars, ~${fullScriptText.split(/\s+/).length} words).`
    );

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
