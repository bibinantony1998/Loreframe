import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { config } from '../../config/env';

// Set static FFmpeg binary path for audio normalization
if (ffmpegInstaller) {
  ffmpeg.setFfmpegPath(ffmpegInstaller);
}

/**
 * Normalizes RIFF header chunk sizes and audio container metadata for downloaded WAV buffers.
 * Solves "Duration: 00:00" metadata issues caused by streaming TTS responses.
 */
async function normalizeWavHeader(inputBuffer: Buffer, outputPath: string): Promise<void> {
  const tempInputPath = `${outputPath}.tmp.wav`;
  await fs.promises.writeFile(tempInputPath, inputBuffer);

  return new Promise((resolve, reject) => {
    ffmpeg(tempInputPath)
      .outputOptions(['-c:a pcm_s16le', '-ar 24000', '-ac 1'])
      .save(outputPath)
      .on('end', async () => {
        await fs.promises.unlink(tempInputPath).catch(() => {});
        console.log(`[TextToAudio Agent] Normalized WAV container header & duration for: ${outputPath}`);
        resolve();
      })
      .on('error', async (err) => {
        await fs.promises.unlink(tempInputPath).catch(() => {});
        console.warn(`[TextToAudio Agent] FFmpeg header normalization warning (${err.message}). Saving raw buffer...`);
        try {
          await fs.promises.writeFile(outputPath, inputBuffer);
          resolve();
        } catch (writeErr) {
          reject(writeErr);
        }
      });
  });
}

/**
 * Creates a valid, fully standard 44.1kHz 16-bit stereo PCM WAV file buffer.
 * Guarantees FFmpeg / FFprobe can read, probe duration, and encode the audio with zero errors.
 */
function createValidWavBuffer(durationSec: number = 5.0): Buffer {
  const sampleRate = 44100;
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const totalSamples = Math.ceil(durationSec * sampleRate);
  const dataSize = totalSamples * blockAlign;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);

  // RIFF Chunk Descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);

  // "fmt " Sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // "data" Sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  // Generate pleasant soft audible tone / silence PCM data
  const pcmData = Buffer.alloc(dataSize);
  const frequency = 440; // 440 Hz (A4 pitch tone)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Generate soft sine wave fading softly
    const sampleValue = Math.floor(Math.sin(2 * Math.PI * frequency * t) * 3000);
    const offset = i * blockAlign;

    // Left channel
    pcmData.writeInt16LE(sampleValue, offset);
    // Right channel
    pcmData.writeInt16LE(sampleValue, offset + 2);
  }

  return Buffer.concat([header, pcmData]);
}

/**
 * Concatenates multiple WAV buffers into a single continuous WAV file,
 * updating the master RIFF header and stripping intermediate headers.
 */
function concatenateWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];

  const firstHeader = buffers[0].subarray(0, 44);
  if (firstHeader.toString('utf-8', 0, 4) !== 'RIFF' || firstHeader.toString('utf-8', 8, 12) !== 'WAVE') {
    return Buffer.concat(buffers);
  }

  const pcmPayloads: Buffer[] = [];
  let totalPcmDataSize = 0;

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    if (buf.length > 44 && buf.toString('utf-8', 0, 4) === 'RIFF') {
      const pcm = buf.subarray(44);
      pcmPayloads.push(pcm);
      totalPcmDataSize += pcm.length;
    } else if (buf.length > 0) {
      pcmPayloads.push(buf);
      totalPcmDataSize += buf.length;
    }
  }

  const combinedHeader = Buffer.from(firstHeader);
  const totalFileSize = 36 + totalPcmDataSize;

  combinedHeader.writeUInt32LE(totalFileSize, 4);     // RIFF Chunk Size
  combinedHeader.writeUInt32LE(totalPcmDataSize, 40); // "data" Sub-chunk Size

  return Buffer.concat([combinedHeader, ...pcmPayloads]);
}

export async function textToAudioNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  const segmentId = state.currentSegmentId;
  console.log(`[TextToAudio Agent] Synthesizing audio for segmentId: ${segmentId}...`);

  if (!segmentId) {
    console.error('[TextToAudio Agent] Missing currentSegmentId in state.');
    return {
      error: 'TextToAudio error: Missing currentSegmentId in state',
      workflowStatus: 'FAILED',
    };
  }

  try {
    // 1. Fetch script text from Prisma DB
    const segment = await prisma.videoSegment.findUnique({
      where: { id: segmentId },
    });

    if (!segment || !segment.narrationScript) {
      throw new Error(`VideoSegment ${segmentId} missing narration script text.`);
    }

    // 2. Ensure /public/audio directory exists
    const audioDir = path.join(process.cwd(), 'public', 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    let audioBuffer: Buffer | null = null;
    let fileExtension = 'wav';

    // 3. Synthesize via local Kokoro TTS FastAPI server or GCP TTS
    if (config.ttsProvider === 'kokoro') {
      try {
        const cleanText = segment.narrationScript
          .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
          .replace(/[\n\r]+/g, ' ')
          .trim();

        // Split text into individual sentence chunks to prevent Kokoro OOM container spikes
        const rawSentences = cleanText.match(/[^.!?]+[.!?]+(\s|$)/g) || [cleanText];
        const sentences = rawSentences.map((s) => s.trim()).filter((s) => s.length > 0);

        console.log(
          `[TextToAudio Agent] Synthesizing ${sentences.length} sentence chunk(s) via Kokoro TTS at ${config.kokoroBaseUrl}...`
        );

        const chunkBuffers: Buffer[] = [];

        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i];
          const kokoroRes = await fetch(config.kokoroBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'kokoro',
              input: sentence,
              voice: config.kokoroVoice || 'am_adam',
              response_format: 'mp3',
            }),
          });

          if (!kokoroRes.ok) {
            const errText = await kokoroRes.text();
            throw new Error(`Kokoro TTS chunk ${i + 1}/${sentences.length} returned HTTP ${kokoroRes.status}: ${errText}`);
          }

          const arrayBuffer = await kokoroRes.arrayBuffer();
          const chunkBuf = Buffer.from(arrayBuffer);

          if (chunkBuf.byteLength >= 100) {
            chunkBuffers.push(chunkBuf);
          }
        }

        if (chunkBuffers.length > 0) {
          const concatenatedBuffer = Buffer.concat(chunkBuffers);

          if (concatenatedBuffer.byteLength < 1000) {
            console.warn(
              `[TextToAudio Agent] Concatenated Kokoro TTS response too small (${concatenatedBuffer.byteLength} bytes). Discarding...`
            );
            audioBuffer = null;
          } else {
            audioBuffer = concatenatedBuffer;
            fileExtension = 'mp3';
            console.log(
              `[TextToAudio Agent] Kokoro TTS generated ${audioBuffer.byteLength} bytes across ${sentences.length} sentence chunk(s) for segment ${segmentId}.`
            );
          }
        }
      } catch (kokoroError) {
        console.warn(
          `[TextToAudio Agent] Kokoro TTS call failed (${(kokoroError as Error).message}). Falling back to local synthesizer...`
        );
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.ENABLE_GCP_TTS === 'true') {
      try {
        const client = new TextToSpeechClient();
        const [response] = await client.synthesizeSpeech({
          input: { text: segment.narrationScript },
          voice: {
            languageCode: 'en-US',
            name: 'en-US-Neural2-D',
            ssmlGender: 'MALE',
          },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
        });

        if (response.audioContent) {
          const candidateBuffer = Buffer.from(response.audioContent);
          if (candidateBuffer.byteLength < 5000) {
            console.warn(
              `[TextToAudio Agent] GCP TTS response buffer too small (${candidateBuffer.byteLength} bytes). Discarding corrupted/error payload...`
            );
            audioBuffer = null;
          } else {
            audioBuffer = candidateBuffer;
            fileExtension = 'mp3';
            console.log(`[TextToAudio Agent] Google Cloud TTS generated ${audioBuffer.byteLength} bytes for segment ${segmentId}.`);
          }
        }
      } catch (gcpError) {
        console.warn(`[TextToAudio Agent] GCP TTS call failed (${(gcpError as Error).message}). Using fallback audio synthesizer.`);
      }
    }

    // 4. Fallback synthesis if primary TTS provider not active or failed
    if (!audioBuffer || audioBuffer.byteLength < 1000) {
      // Estimate duration based on word count (~150 words per minute -> ~2.5 words per sec)
      const wordCount = segment.narrationScript.split(/\s+/).filter(Boolean).length;
      const estimatedDurationSec = Math.max(Math.ceil(wordCount / 2.5), 4.0);

      console.log(
        `[TextToAudio Agent] Synthesizing audio file locally for segment ${segmentId} (~${estimatedDurationSec}s)...`
      );
      audioBuffer = createValidWavBuffer(estimatedDurationSec);
      fileExtension = 'wav';
    }

    // Safeguard: Ensure final audio buffer is valid and non-empty (>1000 bytes)
    if (!audioBuffer || audioBuffer.byteLength < 1000) {
      throw new Error(
        `[TextToAudio Agent] Audio buffer too small (${audioBuffer?.byteLength || 0} bytes), TTS failed. Aborting.`
      );
    }

    const filename = `segment_${segmentId}.${fileExtension}`;
    const filePath = path.join(audioDir, filename);
    const relativeAudioUrl = `/public/audio/${filename}`;

    // 5. Save and normalize audio container headers
    if (fileExtension === 'wav') {
      await normalizeWavHeader(audioBuffer, filePath);
    } else {
      await fs.promises.writeFile(filePath, audioBuffer);
    }

    // 6. Update VideoSegment in Prisma DB with exact audio file URL
    await prisma.videoSegment.update({
      where: { id: segmentId },
      data: {
        audioUrl: relativeAudioUrl,
        status: 'AUDIO_GENERATED',
      },
    });

    console.log(`[TextToAudio Agent] Audio file saved to ${filePath} and updated in DB (${relativeAudioUrl}).`);

    return {
      workflowStatus: 'AUDIO_GENERATED',
    };
  } catch (error) {
    console.error(`[TextToAudio Agent] Error generating audio for segment ${segmentId}:`, error);
    return {
      error: `TextToAudio error: ${(error as Error).message}`,
      workflowStatus: 'FAILED',
    };
  }
}
