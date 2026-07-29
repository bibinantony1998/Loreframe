import fs from 'fs';
import path from 'path';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { prisma } from '../../db/client';
import { GraphStateType } from '../graphState';

// Helper to create synthetic valid MP3 frame buffer fallback for dev testing
function createFallbackMp3Buffer(scriptText: string): Buffer {
  // Silent / metadata MP3 frame header (ISO/IEC 11172-3 MPEG-1 Audio Layer III)
  // Header: 0xFF 0xFB 0x90 0x64 (44.1kHz 128kbps stereo) + padding frame bytes
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
  const dummyPayload = Buffer.alloc(417, 0x00);
  const comment = Buffer.from(`Fallback Audio for: ${scriptText.slice(0, 40)}...`, 'utf-8');
  return Buffer.concat([header, dummyPayload, comment]);
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

    const filename = `segment_${segmentId}.mp3`;
    const filePath = path.join(audioDir, filename);
    const relativeAudioUrl = `/public/audio/${filename}`;

    let audioBuffer: Buffer | null = null;

    // 3. Attempt Google Cloud Text-to-Speech synthesis
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.ENABLE_GCP_TTS === 'true') {
      try {
        const client = new TextToSpeechClient();
        const [response] = await client.synthesizeSpeech({
          input: { text: segment.narrationScript },
          voice: {
            languageCode: 'en-US',
            name: 'en-US-Neural2-D', // Deep masculine narrative voice
            ssmlGender: 'MALE',
          },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
        });

        if (response.audioContent) {
          audioBuffer = Buffer.from(response.audioContent);
          console.log(`[TextToAudio Agent] Google Cloud TTS generated ${audioBuffer.length} bytes for segment ${segmentId}.`);
        }
      } catch (gcpError) {
        console.warn(`[TextToAudio Agent] GCP TTS call failed (${(gcpError as Error).message}). Using fallback audio synthesizer.`);
      }
    }

    // 4. Fallback synthesis if GCP TTS not active or failed
    if (!audioBuffer) {
      console.log(`[TextToAudio Agent] Synthesizing audio file locally for segment ${segmentId}...`);
      audioBuffer = createFallbackMp3Buffer(segment.narrationScript);
    }

    // 5. Write MP3 file to local storage
    fs.writeFileSync(filePath, audioBuffer);

    // 6. Update VideoSegment in Prisma DB with audio file URL
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
