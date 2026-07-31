import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import sharp from 'sharp';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { broadcastAgentStatus } from '../../utils/wsBroadcaster';

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

/**
 * Renders a single image sub-clip with Ken Burns motion effect over subDuration.
 */
function renderImageSubClip(
  imagePath: string,
  outputPath: string,
  subDuration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const frames = Math.ceil(subDuration * 25);
    const filterStr = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.001,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080,format=yuv420p`;

    const command = ffmpeg();

    if (imagePath && fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
      command.input(imagePath).loop(subDuration);
    } else {
      command.input('color=c=0x0f172a:s=1920x1080').inputFormat('lavfi').duration(subDuration);
    }

    command
      .videoFilters(filterStr)
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 25',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => {
        console.error(`[VideoAssembler] Image sub-clip rendering failed for ${outputPath}:`, err.message);
        reject(err);
      })
      .run();
  });
}

/**
 * Concatenates visual clips into a single video file.
 */
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
      fs.copyFileSync(clipPaths[0], finalOutputPath);
      return resolve();
    }

    const command = ffmpeg();
    clipPaths.forEach((clip) => command.input(clip));

    command
      .on('end', () => resolve())
      .on('error', (err) => {
        console.error(`[VideoAssembler] Visual concatenation error:`, err.message);
        reject(err);
      })
      .mergeToFile(finalOutputPath, process.cwd());
  });
}

/**
 * Combines all audio segment tracks into a single continuous master audio track,
 * completely eliminating silence dropouts between chapter transitions.
 */
function concatenateAudioTracks(audioPaths: string[], masterAudioPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (audioPaths.length === 0) {
      return reject(new Error('No audio tracks provided for master audio concatenation'));
    }

    const validAudioPaths = audioPaths.filter((p) => p && fs.existsSync(p) && fs.statSync(p).size > 0);

    if (validAudioPaths.length === 0) {
      return reject(new Error('No valid non-empty audio files found for master audio concatenation'));
    }

    if (validAudioPaths.length === 1) {
      fs.copyFileSync(validAudioPaths[0], masterAudioPath);
      return resolve();
    }

    // Try buffer concatenation for MP3 tracks
    const isAllMp3 = validAudioPaths.every((p) => p.toLowerCase().endsWith('.mp3'));
    if (isAllMp3) {
      try {
        const buffers = validAudioPaths.map((p) => fs.readFileSync(p));
        const combined = Buffer.concat(buffers);
        fs.writeFileSync(masterAudioPath, combined);
        console.log(`[VideoAssembler] Combined ${validAudioPaths.length} MP3 audio tracks into master audio.`);
        return resolve();
      } catch (err) {
        console.warn(`[VideoAssembler] Buffer concatenation warning (${(err as Error).message}), falling back to FFmpeg concat...`);
      }
    }

    const command = ffmpeg();
    validAudioPaths.forEach((p) => command.input(p));

    command
      .on('end', () => {
        console.log(`[VideoAssembler] Concatenated ${validAudioPaths.length} audio tracks into master audio.`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[VideoAssembler] Master audio concatenation error:`, err.message);
        reject(err);
      })
      .mergeToFile(masterAudioPath, process.cwd());
  });
}

/**
 * Merges master visual video and continuous master audio track into final MP4 video.
 */
function mergeVisualsAndAudio(
  visualsPath: string,
  masterAudioPath: string,
  finalOutputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(visualsPath)
      .input(masterAudioPath)
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        '-ar 44100',
        '-shortest',
      ])
      .output(finalOutputPath)
      .on('end', () => {
        console.log(`[VideoAssembler] Final documentary video merged: ${finalOutputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`[VideoAssembler] Error merging master visuals and audio:`, err.message);
        reject(err);
      })
      .run();
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

  broadcastAgentStatus({
    jobId: state.jobId,
    activeAgent: 'VideoAssemblerAgent',
    currentTask: 'Rendering and concatenating multi-scene visual clips and continuous audio...',
    progressPercentage: 90,
    status: 'running',
  });

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

    const tempSubClips: string[] = [];
    const validAudioPaths: string[] = [];

    // 3. Process each chapter segment and generate multi-image sub-clips
    for (const segment of segments) {
      const audioAbsPath = segment.audioUrl
        ? path.join(process.cwd(), segment.audioUrl.replace(/^\//, ''))
        : '';

      if (segment.audioUrl && !fs.existsSync(audioAbsPath)) {
        throw new Error(`Missing audio file for segment ${segment.id}: ${audioAbsPath}`);
      }

      if (audioAbsPath) {
        validAudioPaths.push(audioAbsPath);
      }

      const totalSegmentDuration = await getAudioDuration(audioAbsPath);

      // Parse image URLs (single string or JSON array)
      let rawImageUrls: string[] = [];
      if (segment.imageUrl) {
        try {
          const parsed = JSON.parse(segment.imageUrl);
          if (Array.isArray(parsed) && parsed.length > 0) {
            rawImageUrls = parsed;
          } else {
            rawImageUrls = [segment.imageUrl];
          }
        } catch {
          rawImageUrls = [segment.imageUrl];
        }
      }

      const imageAbsPaths: string[] = [];
      for (const relUrl of rawImageUrls) {
        const absPath = path.join(process.cwd(), relUrl.replace(/^\//, ''));
        if (fs.existsSync(absPath)) {
          const raster = await ensureRasterImage(absPath);
          imageAbsPaths.push(raster);
        }
      }

      const sceneCount = Math.max(imageAbsPaths.length, 1);
      const subDuration = totalSegmentDuration / sceneCount;

      console.log(
        `[VideoAssembler] Chapter ${segment.sequenceIndex} ("${segment.title}"): Rendering ${sceneCount} visual scene(s) across ${totalSegmentDuration.toFixed(1)}s total duration...`
      );

      for (let imgIdx = 0; imgIdx < sceneCount; imgIdx++) {
        const imgPath = imageAbsPaths[imgIdx] || '';
        const subClipPath = path.join(videosDir, `clip_${segment.id}_sub_${imgIdx}.mp4`);

        await renderImageSubClip(imgPath, subClipPath, subDuration);
        tempSubClips.push(subClipPath);
      }
    }

    // 4. Concatenate visual sub-clips into a continuous master visual track
    const masterVisualsPath = path.join(videosDir, `master_visuals_${state.jobId}.mp4`);
    console.log(`[VideoAssembler] Concatenating ${tempSubClips.length} visual scene clips into master visual track...`);
    await concatenateClips(tempSubClips, masterVisualsPath);

    // 5. Concatenate audio tracks into a continuous master audio track
    const masterAudioPath = path.join(videosDir, `master_audio_${state.jobId}.mp3`);
    console.log(`[VideoAssembler] Combining ${validAudioPaths.length} audio tracks into continuous master audio track...`);
    await concatenateAudioTracks(validAudioPaths, masterAudioPath);

    // 6. Merge master visual track + continuous master audio track into final video
    console.log(`[VideoAssembler] Merging continuous master visuals and master audio into final video...`);
    await mergeVisualsAndAudio(masterVisualsPath, masterAudioPath, finalVideoPath);

    // 7. Cleanup temporary intermediate files
    console.log(`[VideoAssembler] Cleaning up temporary intermediate asset files for Job ${state.jobId}...`);

    const filesToDelete = [masterVisualsPath, masterAudioPath, ...tempSubClips];
    for (const f of filesToDelete) {
      try {
        if (fs.existsSync(f)) await fs.promises.unlink(f);
      } catch (e) {
        console.warn(`[VideoAssembler] Warning deleting temp file ${f}: ${(e as Error).message}`);
      }
    }

    for (const segment of segments) {
      if (segment.audioUrl) {
        const absPath = path.join(process.cwd(), segment.audioUrl.replace(/^\//, ''));
        try {
          if (fs.existsSync(absPath)) await fs.promises.unlink(absPath);
        } catch (e) {
          console.warn(`[VideoAssembler] Warning deleting audio ${absPath}: ${(e as Error).message}`);
        }
      }

      if (segment.imageUrl) {
        try {
          let urls: string[] = [];
          const parsed = JSON.parse(segment.imageUrl);
          if (Array.isArray(parsed)) urls = parsed;
          else urls = [segment.imageUrl];

          for (const u of urls) {
            const absPath = path.join(process.cwd(), u.replace(/^\//, ''));
            if (fs.existsSync(absPath)) await fs.promises.unlink(absPath);
          }
        } catch {
          const absPath = path.join(process.cwd(), segment.imageUrl.replace(/^\//, ''));
          try {
            if (fs.existsSync(absPath)) await fs.promises.unlink(absPath);
          } catch (e) {
            console.warn(`[VideoAssembler] Warning deleting image ${absPath}: ${(e as Error).message}`);
          }
        }
      }
    }

    // 8. Finalize Job status in database
    await prisma.videoJob.update({
      where: { id: state.jobId },
      data: {
        status: 'COMPLETED',
        metadata: JSON.stringify({ videoUrl: relativeVideoUrl }),
      },
    });

    console.log(`[VideoAssembler] Final documentary video ready at: ${relativeVideoUrl}`);

    broadcastAgentStatus({
      jobId: state.jobId,
      activeAgent: 'VideoAssemblerAgent',
      currentTask: 'Documentary video assembly completed successfully!',
      progressPercentage: 100,
      status: 'completed',
      assetUrl: relativeVideoUrl,
      assetType: 'video',
      logMessage: `Final documentary video assembled and exported at ${relativeVideoUrl}`,
    });

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
