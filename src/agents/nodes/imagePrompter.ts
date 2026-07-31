import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { createLLM } from '../../utils/llmFactory';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { executeWithRateLimit } from '../../utils/rateLimiter';
import { broadcastAgentStatus } from '../../utils/wsBroadcaster';

if (ffprobeInstaller && ffprobeInstaller.path) {
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
}

function probeAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      return resolve(0);
    }
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        return resolve(0);
      }
      resolve(metadata.format.duration);
    });
  });
}

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

    broadcastAgentStatus({
      jobId: state.jobId,
      activeAgent: 'ImagePrompterAgent',
      currentTask: `Crafting scene prompts for Chapter ${segment.sequenceIndex}: "${segment.title || ''}"`,
      chapterIndex: segment.sequenceIndex,
      totalChapters: state.chapters.length || 5,
      progressPercentage: Math.min(55 + segment.sequenceIndex * 5, 75),
      status: 'running',
    });

    const narrationText = (segment.narrationScript || '').trim();

    // 2. Probe exact audio duration to dynamically scale image count (1 image per 30s)
    const audioAbsPath = segment.audioUrl
      ? path.join(process.cwd(), segment.audioUrl.replace(/^\//, ''))
      : '';

    let durationSec = await probeAudioDuration(audioAbsPath);

    if (durationSec <= 0 && narrationText) {
      const wordCount = narrationText.split(/\s+/).filter(Boolean).length;
      durationSec = Math.max(wordCount / 2.5, 10.0);
    }

    // Rule: 1 image per 30 seconds of audio (minimum 1 image)
    const requiredImageCount = Math.max(1, Math.ceil(durationSec / 30));

    console.log(
      `[ImagePrompter Agent] Chapter ${segment.sequenceIndex} audio duration: ${durationSec.toFixed(1)}s -> Scaling to ${requiredImageCount} scene image prompt(s) (1 per 30s)...`
    );

    // 3. Call LLM via Factory & Rate Limiter to produce requiredImageCount distinct scene prompts
    const prompt = `You are a master visual director and AI prompt engineer for high-end historical documentaries.
Craft an array of exactly ${requiredImageCount} distinct, highly detailed, illustrative visual prompts for Chapter ${segment.sequenceIndex}: "${segment.title || state.topic}".

Documentary Topic: "${state.topic}"
Chapter Title: "${segment.title || ''}"
Voiceover Narration Script: "${narrationText}"

Instructions:
- Return a JSON object with a "prompts" key containing an array of EXACTLY ${requiredImageCount} distinct prompt strings.
- Each prompt must capture a sequential scene in this chapter's narration.
- Describe the visual composition, subjects, setting, lighting, and mood clearly in text.
- Output JSON format strictly:
{
  "prompts": [
    "Wide-angle illustrative scene depicting...",
    "Detailed historical painting showing..."
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
      for (let k = 0; k < requiredImageCount; k++) {
        promptsArray.push(`Cinematic documentary illustration of ${segment.title || state.topic} (Scene ${k + 1})`);
      }
    }

    if (promptsArray.length === 0) {
      for (let k = 0; k < requiredImageCount; k++) {
        promptsArray.push(`Cinematic documentary illustration of ${segment.title || state.topic} (Scene ${k + 1})`);
      }
    }

    // Ensure prompt array count matches requiredImageCount
    if (promptsArray.length > requiredImageCount) {
      promptsArray = promptsArray.slice(0, requiredImageCount);
    }

    // 4. Force-append mandatory artistic style suffix
    const finalPrompts = promptsArray.map((p) => {
      const cleanP = extractStringFromPrompt(p);
      const trimmed = cleanP.trim();
      if (trimmed.endsWith(MANDATORY_STYLE_SUFFIX)) return trimmed;
      return `${trimmed}${MANDATORY_STYLE_SUFFIX}`;
    });

    const jsonPromptsString = JSON.stringify(finalPrompts);

    // 5. Update VideoSegment in Prisma DB
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        imagePrompt: jsonPromptsString,
      },
    });

    console.log(
      `[ImagePrompter Agent] Saved ${finalPrompts.length} dynamic scene prompt(s) for segment ${segmentId}. Sample: "${finalPrompts[0].slice(0, 80)}..."`
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
