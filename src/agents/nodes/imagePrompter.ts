import { createLLM } from '../../utils/llmFactory';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { config } from '../../config/env';

const MANDATORY_STYLE_SUFFIX =
  ', highly detailed cinematic documentary illustration, historical art style, watercolor and ink, wide-angle aerial perspective, intricate detail, muted earth tones, parchment texture, masterpiece, 8k';

export async function imagePrompterNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const segmentId = state.currentSegmentId;
  console.log(`[ImagePrompter Agent] Crafting visual prompts for segmentId: ${segmentId}...`);

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

    const narrationText = (segment.narrationScript || '').trim();
    const fallbackBase = narrationText.length > 20
      ? narrationText.slice(0, 150)
      : `Historical documentary scene for Chapter ${segment.sequenceIndex}: ${segment.title || state.topic}`;

    // 2. Call LLM via Factory & Rate Limiter to produce 3-4 distinct scene prompts
    const prompt = `You are a master visual director and AI prompt engineer for high-end historical documentaries.
Craft an array of 3 to 4 distinct, highly detailed, illustrative visual prompts for Chapter ${segment.sequenceIndex}: "${segment.title || state.topic}".

Documentary Topic: "${state.topic}"
Chapter Title: "${segment.title || ''}"
Voiceover Narration Script: "${narrationText}"

Instructions:
- Return a JSON object with a "prompts" key containing an array of 3 to 4 distinct prompt strings.
- Each prompt must describe a specific visual scene (e.g. Scene 1: architecture/palaces, Scene 2: military legions/battles, Scene 3: rulers/aristocrats, Scene 4: landscapes/events).
- Describe the visual composition, subjects, setting, lighting, and mood clearly in text.
- Output JSON format strictly:
{
  "prompts": [
    "Wide-angle illustrative scene depicting...",
    "Detailed historical painting showing...",
    "Cinematic documentary artwork of...",
    "Atmospheric composition portraying..."
  ]
}`;

    let promptsArray: string[] = [];

    try {
      const response = await executeWithRateLimit(
        async (apiKey) => {
          const model = createLLM({
            requireJson: true,
            apiKey: apiKey,
            temperature: 0.7,
          });
          return model.invoke(prompt);
        },
        `ImagePrompter-${segment.sequenceIndex}`,
        state.jobId,
        prompt
      );

      const contentText = typeof response.content === 'string' ? response.content.trim() : JSON.stringify(response.content);

      const cleanedJson = contentText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleanedJson);

      if (Array.isArray(parsed.prompts) && parsed.prompts.length > 0) {
        promptsArray = parsed.prompts.map(extractStringFromPrompt);
      } else if (Array.isArray(parsed) && parsed.length > 0) {
        promptsArray = parsed.map(extractStringFromPrompt);
      }
    } catch (parseErr) {
      console.warn(`[ImagePrompter Agent] Prompt generation/parsing fallback: ${(parseErr as Error).message}`);
      promptsArray = [
        `Cinematic documentary illustration of ${segment.title || state.topic}`,
        `Wide-angle historical artwork depicting ${state.topic}`,
        `Detailed documentary scene showing ${segment.title || state.topic}`,
      ];
    }

    if (promptsArray.length === 0) {
      promptsArray = [`Cinematic documentary illustration of ${segment.title || state.topic}`];
    }

    // 3. Force-append mandatory artistic style suffix & guarantee no [object Object]
    const finalPrompts = promptsArray.map((p) => {
      const cleanP = extractStringFromPrompt(p);
      const trimmed = cleanP.trim();
      if (trimmed.endsWith(MANDATORY_STYLE_SUFFIX)) return trimmed;
      return `${trimmed}${MANDATORY_STYLE_SUFFIX}`;
    });

    const jsonPromptsString = JSON.stringify(finalPrompts);

    // 4. Update VideoSegment in Prisma DB
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        imagePrompt: jsonPromptsString,
      },
    });

    console.log(
      `[ImagePrompter Agent] Created ${finalPrompts.length} documentary illustration prompt(s) for segment ${segmentId}. Sample: "${finalPrompts[0].slice(0, 80)}..."`
    );

    return {
      workflowStatus: 'IMAGE_PROMPTED',
    };
  } catch (error) {
    console.error(`[ImagePrompter Agent] Error generating image prompts for segment ${segmentId}:`, error);
    return {
      error: `ImagePrompter error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}

function extractStringFromPrompt(val: any): string {
  if (typeof val === 'string') return val;
  if (!val) return 'Cinematic documentary illustration of historical scene';
  if (typeof val === 'object') {
    if (typeof val.prompt === 'string') return val.prompt;
    if (typeof val.text === 'string') return val.text;
    if (typeof val.description === 'string') return val.description;
    return JSON.stringify(val);
  }
  return String(val);
}
