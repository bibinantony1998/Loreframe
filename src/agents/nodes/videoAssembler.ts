import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import sharp from 'sharp';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';

// Set static FFmpeg & FFprobe binary paths
if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller);
}
if (ffprobeInstaller && ffprobeInstaller.path) {
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
}

/**
 * Ensures input image is a raster image (.png or .jpg).
 * Converts legacy .svg files to .png using Sharp before passing to FFmpeg.
 */
async function ensureRasterImage(imagePath: string): Promise<string> {
  if (!imagePath || !fs.existsSync(imagePath)) return imagePath;

  if (imagePath.toLowerCase().endsWith('.svg')) {
    const pngPath = imagePath.substring(0, imagePath.length - 4) + '.png';
    try {
      await sharp(imagePath).png().toFile(pngPath);
      console.log(`[VideoAssembler] Rasterized legacy SVG image to PNG: ${pngPath}`);
      return pngPath;
    } catch (e) {
      console.warn(`[VideoAssembler] Failed to rasterize SVG image ${imagePath}: ${(e as Error).message}`);
    }
  }

  return imagePath;
}

// Helper to probe audio duration in seconds with strict existence & non-zero file validation
function getAudioDuration(audioFilePath: string): Promise<number> {
  return new Promise((resolve) => {
    if (!audioFilePath || !fs.existsSync(audioFilePath)) {
      console.warn(`[VideoAssembler] Audio file missing at "${audioFilePath}".`);
      return resolve(5.0);
    }

    const stat = fs.statSync(audioFilePath);
    if (stat.size === 0) {
      console.warn(`[VideoAssembler] Audio file at "${audioFilePath}" is 0 bytes. Defaulting to 5s.`);
      return resolve(5.0);
    }

    ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        console.warn(`[VideoAssembler] FFprobe warning for ${audioFilePath}:`, err?.message || 'Unknown probe error');
        return resolve(5.0);
      }
      const duration = Math.max(metadata.format.duration, 2.0);
      resolve(duration);
    });
  });
}

// Helper to render single video clip (image + audio + Ken Burns zoom effect)
function renderSegmentClip(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  duration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check file existence before FFmpeg execution
    if (imagePath && !fs.existsSync(imagePath)) {
      console.warn(`[VideoAssembler] Missing image input file: ${imagePath}. Using color canvas fallback.`);
    }

    if (audioPath && !fs.existsSync(audioPath)) {
      console.warn(`[VideoAssembler] Missing audio input file: ${audioPath}. Using silent audio fallback.`);
    }

    // Zoompan filter: slow Ken Burns zoom in over duration
    const frames = Math.ceil(duration * 25);
    const filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.001,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,format=yuv420p`;

    const command = ffmpeg();

    if (imagePath && fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
      command.input(imagePath).loop(duration);
    } else {
      // Fallback color canvas if image is missing or empty
      command.input('color=c=0x0f172a:s=1920x1080').inputFormat('lavfi').duration(duration);
    }

    if (audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0) {
      command.input(audioPath);
    } else {
      command.input('anullsrc=r=24000:cl=stereo').inputFormat('lavfi').duration(duration);
    }

    command
      .videoFilters(filterStr)
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',   // CRITICAL for macOS QuickTime compatibility
        '-c:a aac',
        '-b:a 128k',
        '-ar 24000',          // CRITICAL: Match Kokoro native 24kHz sample rate to prevent distortion
        '-shortest',
      ])
      .output(outputPath)
      .on('end', () => {
        console.log(`[VideoAssembler] Rendered clip: ${outputPath} (${duration.toFixed(1)}s)`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[VideoAssembler] Clip rendering failed for ${outputPath}:`, err.message);
        reject(err);
      })
      .run();
  });
}

// Helper to concatenate list of MP4 clips into final output video
function concatenateClips(clipPaths: string[], finalOutputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (clipPaths.length === 0) {
      return reject(new Error('No video clips available for concatenation'));
    }

    for (const clip of clipPaths) {
      if (!fs.existsSync(clip)) {
        return reject(new Error(`Missing input file for FFmpeg concatenation: ${clip}`));
      }
    }

    if (clipPaths.length === 1) {
      // Single clip: copy to final destination
      fs.copyFileSync(clipPaths[0], finalOutputPath);
      return resolve();
    }

    const command = ffmpeg();
    clipPaths.forEach((clip) => command.input(clip));

    command
      .on('end', () => {
        console.log(`[VideoAssembler] Successfully concatenated ${clipPaths.length} clips into ${finalOutputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[VideoAssembler] Concatenation error:`, err.message);
        reject(err);
      })
      .mergeToFile(finalOutputPath, process.cwd());
  });
}

export async function videoAssemblerNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  console.log(`[VideoAssembler Agent] Assembling final documentary video for Job ID: ${state.jobId}...`);

  if (!state.jobId) {
    return {
      error: 'VideoAssembler error: Missing jobId in graph state',
      workflowStatus: 'FAILED',
    };
  }

  try {
    // 1. Fetch segments from DB ordered by sequenceIndex
    const segments = await prisma.videoSegment.findMany({
      where: { jobId: state.jobId },
      orderBy: { sequenceIndex: 'asc' },
    });

    if (segments.length === 0) {
      throw new Error(`No VideoSegment records found for Job ${state.jobId}`);
    }

    // 2. Ensure /public/videos directory exists
    const videosDir = path.join(process.cwd(), 'public', 'videos');
    if (!fs.existsSync(videosDir)) {
      fs.mkdirSync(videosDir, { recursive: true });
    }

    const finalFilename = `output_${state.jobId}.mp4`;
    const finalVideoPath = path.join(videosDir, finalFilename);
    const relativeVideoUrl = `/public/videos/${finalFilename}`;

    // Update job status in DB to ASSET_GENERATION
    await prisma.videoJob.update({
      where: { id: state.jobId },
      data: { status: 'ASSET_GENERATION' },
    });

    // 3. Process and render individual clips
    const clipPaths: string[] = [];
    for (const segment of segments) {
      const audioAbsPath = segment.audioUrl
        ? path.join(process.cwd(), segment.audioUrl.replace(/^\//, ''))
        : '';
      const imageAbsPath = segment.imageUrl
        ? path.join(process.cwd(), segment.imageUrl.replace(/^\//, ''))
        : '';

      // Validate inputs if explicitly supplied
      if (segment.audioUrl && !fs.existsSync(audioAbsPath)) {
        throw new Error(`Missing input file for FFmpeg: ${audioAbsPath}`);
      }
      if (segment.imageUrl && !fs.existsSync(imageAbsPath)) {
        throw new Error(`Missing input file for FFmpeg: ${imageAbsPath}`);
      }

      const duration = await getAudioDuration(audioAbsPath);
      const clipPath = path.join(videosDir, `clip_${segment.id}.mp4`);

      const rasterImagePath = await ensureRasterImage(imageAbsPath);
      await renderSegmentClip(rasterImagePath, audioAbsPath, clipPath, duration);
      clipPaths.push(clipPath);
    }

    // 4. Concatenate all segment clips into final video
    console.log(`[VideoAssembler] Concatenating ${clipPaths.length} segment clips into ${finalVideoPath}...`);
    await concatenateClips(clipPaths, finalVideoPath);

    // 5. Garbage collection: Clean up intermediate clip, audio, and image files
    console.log(`[VideoAssembler] Cleaning up temporary intermediate asset files for Job ${state.jobId}...`);

    for (const cp of clipPaths) {
      try {
        if (fs.existsSync(cp)) await fs.promises.unlink(cp);
      } catch (e) {
        console.warn(`[VideoAssembler] Warning deleting clip file ${cp}: ${(e as Error).message}`);
      }
    }

    for (const segment of segments) {
      if (segment.audioUrl) {
        const audioAbsPath = path.join(process.cwd(), segment.audioUrl.replace(/^\//, ''));
        try {
          if (fs.existsSync(audioAbsPath)) {
            await fs.promises.unlink(audioAbsPath);
            console.log(`[VideoAssembler] Cleaned up temporary audio: ${audioAbsPath}`);
          }
        } catch (e) {
          console.warn(`[VideoAssembler] Warning deleting temporary audio ${audioAbsPath}: ${(e as Error).message}`);
        }
      }

      if (segment.imageUrl) {
        const imageAbsPath = path.join(process.cwd(), segment.imageUrl.replace(/^\//, ''));
        try {
          if (fs.existsSync(imageAbsPath)) {
            await fs.promises.unlink(imageAbsPath);
            console.log(`[VideoAssembler] Cleaned up temporary image: ${imageAbsPath}`);
          }
        } catch (e) {
          console.warn(`[VideoAssembler] Warning deleting temporary image ${imageAbsPath}: ${(e as Error).message}`);
        }
      }
    }

    // 6. Finalize Job status in database
    await prisma.videoJob.update({
      where: { id: state.jobId },
      data: {
        status: 'COMPLETED',
        metadata: JSON.stringify({ videoUrl: relativeVideoUrl }),
      },
    });

    console.log(`[VideoAssembler] Final documentary video ready at: ${relativeVideoUrl}`);

    return {
      workflowStatus: 'COMPLETED',
    };
  } catch (error) {
    console.error(`[VideoAssembler Agent] Error rendering video for Job ${state.jobId}:`, error);
    return {
      error: `VideoAssembler error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
