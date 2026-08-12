export type VideoJobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface JobSegment {
  id: string;
  sequenceIndex: number;
  title?: string;
  status: string;
  audioUrl?: string;
  imageUrl?: string;
}

export interface StartGenerationRequest {
  topic: string;
  durationMinutes: number;
}

export interface StartGenerationResponse {
  jobId: string;
  topic: string;
  targetLengthMinutes: number;
  status: VideoJobStatus;
  message: string;
  createdAt: string;
}

export interface JobStatusResponse {
  jobId: string;
  topic: string;
  targetLengthMinutes: number;
  status: VideoJobStatus;
  error?: string | null;
  videoUrl?: string | null;
  segmentCount: number;
  segments: JobSegment[];
  createdAt: string;
  updatedAt: string;
}
