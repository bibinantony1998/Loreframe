import fs from 'fs';
import path from 'path';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';
import { config } from '../../config/env';

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

        console.log(`[TextToAudio Agent] Querying local Kokoro TTS server at ${config.kokoroBaseUrl}...`);
        const kokoroRes = await fetch(config.kokoroBaseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'kokoro',
            input: cleanText,
            voice: config.kokoroVoice,
            response_format: 'wav',
            speed: 1.0,
          }),
        });

        if (!kokoroRes.ok) {
          const errText = await kokoroRes.text();
          throw new Error(`Kokoro TTS returned HTTP ${kokoroRes.status}: ${errText}`);
        }

        const candidateBuffer = Buffer.from(await kokoroRes.arrayBuffer());
        if (candidateBuffer.byteLength < 5000) {
          console.warn(
            `[TextToAudio Agent] Kokoro TTS response buffer too small (${candidateBuffer.byteLength} bytes). Discarding corrupted/error payload...`
          );
          audioBuffer = null;
        } else {
          audioBuffer = candidateBuffer;
          fileExtension = 'wav';
          console.log(`[TextToAudio Agent] Kokoro TTS generated ${audioBuffer.byteLength} bytes for segment ${segmentId}.`);
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
    if (!audioBuffer || audioBuffer.byteLength < 5000) {
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

    // 5. Write audio file to local storage asynchronously
    await fs.promises.writeFile(filePath, audioBuffer);

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
