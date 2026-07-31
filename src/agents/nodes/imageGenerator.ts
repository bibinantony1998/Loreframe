import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { config } from '../../config/env';
import { generateComfyImage } from '../../utils/comfyClient';
import { broadcastAgentStatus } from '../../utils/wsBroadcaster';

export async function imageGeneratorNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const segmentId = state.currentSegmentId;
  console.log(`[ImageGenerator Agent] Generating 16:9 visual assets for segmentId: ${segmentId}...`);

  if (!segmentId) {
    console.error('[ImageGenerator Agent] Missing currentSegmentId in state.');
    return {
      error: 'ImageGenerator error: Missing currentSegmentId in state',
      workflowStatus: 'FAILED',
    };
  }

  try {
    // 1. Fetch segment from Prisma DB
    const segment = await prisma.videoSegment.findUnique({
      where: { id: segmentId },
    });

    if (!segment || !segment.imagePrompt) {
      throw new Error(`VideoSegment ${segmentId} missing image prompt.`);
    }

    broadcastAgentStatus({
      jobId: state.jobId,
      activeAgent: 'ImageGeneratorAgent',
      currentTask: `Generating scene images via ComfyUI for Chapter ${segment.sequenceIndex}: "${segment.title || ''}"`,
      chapterIndex: segment.sequenceIndex,
      totalChapters: state.chapters.length || 5,
      progressPercentage: Math.min(65 + segment.sequenceIndex * 5, 85),
      status: 'running',
    });

    // 2. Parse image prompts array or single prompt
    let prompts: string[] = [];
    try {
      const parsed = JSON.parse(segment.imagePrompt);
      if (Array.isArray(parsed) && parsed.length > 0) {
        prompts = parsed.map((p) => String(p).trim());
      } else {
        prompts = [segment.imagePrompt];
      }
    } catch {
      prompts = [segment.imagePrompt];
    }

    console.log(`[ImageGenerator Agent] Generating ${prompts.length} scene image(s) for segment ${segmentId}...`);

    const imagePaths: string[] = [];

    // 3. Generate image for each prompt scene
    for (let index = 0; index < prompts.length; index++) {
      const promptText = prompts[index];
      const filename = prompts.length > 1 ? `segment_${segmentId}_${index}.png` : `segment_${segmentId}.png`;
      let relativeImageUrl = '';

      if (config.imageProvider === 'comfyui') {
        try {
          relativeImageUrl = await generateComfyImage(promptText, filename);
        } catch (comfyError) {
          console.warn(
            `[ImageGenerator Agent] ComfyUI generation failed for scene ${index + 1}/${prompts.length} (${(comfyError as Error).message}). Using fallback asset...`
          );
          relativeImageUrl = await renderFallbackAsset(segmentId, index, segment.title || 'Chapter', promptText);
        }
      } else {
        relativeImageUrl = await renderFallbackAsset(segmentId, index, segment.title || 'Chapter', promptText);
      }

      imagePaths.push(relativeImageUrl);
    }

    const jsonImageUrls = imagePaths.length === 1 ? imagePaths[0] : JSON.stringify(imagePaths);

    // 4. Update VideoSegment in Prisma DB with image URL(s)
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        imageUrl: jsonImageUrls,
        status: 'ASSETS_READY',
      },
    });

    console.log(`[ImageGenerator Agent] Saved ${imagePaths.length} image asset(s) for segment ${segmentId}.`);

    const firstImageUrl = imagePaths[0] || '';
    broadcastAgentStatus({
      jobId: state.jobId,
      activeAgent: 'ImageGeneratorAgent',
      currentTask: `Generated ${imagePaths.length} 16:9 scene visual(s) for Chapter ${segment.sequenceIndex}: "${segment.title || ''}"`,
      chapterIndex: segment.sequenceIndex,
      totalChapters: state.chapters.length || 5,
      progressPercentage: Math.min(70 + segment.sequenceIndex * 5, 88),
      status: 'completed',
      assetUrl: firstImageUrl,
      assetType: 'image',
      logMessage: `Rendered ${imagePaths.length} scene asset(s) stored at ${firstImageUrl}`,
    });

    return {
      workflowStatus: 'IMAGE_GENERATED',
    };
  } catch (error) {
    console.error(`[ImageGenerator Agent] Error generating image for segment ${segmentId}:`, error);
    return {
      error: `ImageGenerator error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}

async function renderFallbackAsset(
  segmentId: string,
  index: number,
  title: string,
  promptText: string
): Promise<string> {
  const imagesDir = path.join(process.cwd(), 'public', 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const filename = index > 0 ? `segment_${segmentId}_${index}.png` : `segment_${segmentId}.png`;
  const filePath = path.join(imagesDir, filename);

  const colors = [
    { bg1: '#0f172a', bg2: '#1e293b', gold: '#f59e0b' },
    { bg1: '#1e1b4b', bg2: '#312e81', gold: '#fbbf24' },
    { bg1: '#18181b', bg2: '#27272a', gold: '#eab308' },
    { bg1: '#022c22', bg2: '#064e3b', gold: '#10b981' },
  ];
  const theme = colors[index % colors.length];

  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg_${index}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.bg1}" />
        <stop offset="100%" stop-color="${theme.bg2}" />
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg_${index})"/>
    <circle cx="960" cy="540" r="400" fill="${theme.gold}" opacity="0.05" />
    <rect x="100" y="100" width="1720" height="880" fill="none" stroke="${theme.gold}" stroke-width="4" opacity="0.4" />
    
    <text x="960" y="440" font-family="Georgia, serif" font-size="54" font-weight="bold" fill="#fef3c7" text-anchor="middle">
      ${escapeXml(title || 'Historical Chapter')} (Scene ${index + 1})
    </text>
    
    <text x="960" y="560" font-family="sans-serif" font-size="24" fill="#94a3b8" text-anchor="middle" width="1400">
      ${escapeXml(promptText.slice(0, 90))}...
    </text>
    
    <text x="960" y="940" font-family="sans-serif" font-size="18" fill="#64748b" text-anchor="middle">
      16:9 Widescreen Visual Scene ${index + 1}
    </text>
  </svg>`;

  // Convert SVG to high-res PNG raster image via Sharp
  await sharp(Buffer.from(svgText)).png().toFile(filePath);
  return `/public/images/${filename}`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
