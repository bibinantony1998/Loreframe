import { StartGenerationResponse, JobStatusResponse } from '../types/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

/**
 * Start video generation process by sending topic and target duration.
 */
export async function startVideoGeneration(
  topic: string,
  durationMinutes: number
): Promise<StartGenerationResponse> {
  const response = await fetch(`${API_BASE_URL}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic,
      durationMinutes,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || errorData.error || `Failed to start video generation (${response.status})`
    );
  }

  return response.json();
}

/**
 * Poll video status by jobId to fetch real-time pipeline status and progress.
 */
export async function pollVideoStatus(jobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/status/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.message || errorData.error || `Failed to fetch video status (${response.status})`
    );
  }

  return response.json();
}
