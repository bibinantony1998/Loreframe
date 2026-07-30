import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { config } from '../../config/env';
import { generateComfyImage } from '../../utils/comfyClient';

export async function imageGeneratorNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const segmentId = state.currentSegmentId;
  console.log(`[ImageGenerator Agent] Generating 16:9 image asset for segmentId: ${segmentId}...`);

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

    let relativeImageUrl = '';

    // 2. Generate image using ComfyUI REST API or fallback renderer
    if (config.imageProvider === 'comfyui') {
      try {
        const outputFilename = `segment_${segmentId}.png`;
        relativeImageUrl = await generateComfyImage(segment.imagePrompt, outputFilename);
      } catch (comfyError) {
        console.warn(
          `[ImageGenerator Agent] ComfyUI generation failed (${(comfyError as Error).message}). Falling back to graphic frame renderer...`
        );
        relativeImageUrl = await renderFallbackAsset(segmentId, segment.title || 'Chapter', segment.imagePrompt);
      }
    } else {
      relativeImageUrl = await renderFallbackAsset(segmentId, segment.title || 'Chapter', segment.imagePrompt);
    }

    // 3. Update VideoSegment in Prisma DB with image URL
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        imageUrl: relativeImageUrl,
        status: 'ASSETS_READY',
      },
    });

    console.log(`[ImageGenerator Agent] Image asset saved (${relativeImageUrl}).`);

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

async function renderFallbackAsset(segmentId: string, title: string, promptText: string): Promise<string> {
  const imagesDir = path.join(process.cwd(), 'public', 'images');
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const filename = `segment_${segmentId}.png`;
  const filePath = path.join(imagesDir, filename);

  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="50%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#020617" />
      </linearGradient>
      <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#f59e0b" />
        <stop offset="100%" stop-color="#d97706" />
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bg)"/>
    <circle cx="960" cy="540" r="400" fill="#f59e0b" opacity="0.05" />
    <rect x="100" y="100" width="1720" height="880" fill="none" stroke="url(#gold)" stroke-width="4" opacity="0.4" />
    
    <text x="960" y="460" font-family="Georgia, serif" font-size="54" font-weight="bold" fill="#fef3c7" text-anchor="middle">
      ${escapeXml(title || 'Historical Chapter')}
    </text>
    
    <text x="960" y="560" font-family="sans-serif" font-size="24" fill="#94a3b8" text-anchor="middle" width="1400">
      ${escapeXml(promptText.slice(0, 90))}...
    </text>
    
    <text x="960" y="940" font-family="sans-serif" font-size="18" fill="#64748b" text-anchor="middle">
      16:9 Widescreen Documentary Artwork Frame
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
