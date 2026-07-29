import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';

// Set static FFmpeg & FFprobe binary paths
if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller);
}
if (ffprobeInstaller && ffprobeInstaller.path) {
  ffmpeg.setFfprobePath(ffprobeInstaller.path);
}

// Helper to probe audio duration in seconds
function getAudioDuration(audioFilePath: string): Promise<number> {
  return new Promise((resolve) => {
    if (!fs.existsSync(audioFilePath)) {
      console.warn(`[VideoAssembler] Audio file not found at ${audioFilePath}. Defaulting duration to 5s.`);
      return resolve(5.0);
    }

    ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        console.warn(`[VideoAssembler] FFprobe error for ${audioFilePath}:`, err?.message);
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
    // Zoompan filter: slow Ken Burns zoom in over duration
    const frames = Math.ceil(duration * 25);
    const filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.001,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,format=yuv420p`;

    const command = ffmpeg();

    if (fs.existsSync(imagePath)) {
      command.input(imagePath).loop(duration);
    } else {
      // Fallback color canvas if image is missing
      command.input('color=c=0x0f172a:s=1920x1080').inputFormat('lavfi').duration(duration);
    }

    if (fs.existsSync(audioPath)) {
      command.input(audioPath);
    } else {
      command.input('anullsrc=r=44100:cl=stereo').inputFormat('lavfi').duration(duration);
    }

    command
      .videoFilters(filterStr)
      .outputOptions([
        '-c:v libx264',
        '-tune stillimage',
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',
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

    // Update job status in DB to RENDERING
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

      const duration = await getAudioDuration(audioAbsPath);
      const clipPath = path.join(videosDir, `clip_${segment.id}.mp4`);

      await renderSegmentClip(imageAbsPath, audioAbsPath, clipPath, duration);
      clipPaths.push(clipPath);
    }

    // 4. Concatenate all segment clips into final video
    console.log(`[VideoAssembler] Concatenating ${clipPaths.length} segment clips into ${finalVideoPath}...`);
    await concatenateClips(clipPaths, finalVideoPath);

    // Clean up intermediate clip files
    clipPaths.forEach((cp) => {
      if (fs.existsSync(cp)) fs.unlinkSync(cp);
    });

    // 5. Finalize Job status in database
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
