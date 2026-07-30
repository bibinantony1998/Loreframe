import fs from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

function ensureLogsDirExists(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

export function logToTaskFile(jobId: string | undefined | null, content: string): void {
  try {
    ensureLogsDirExists();
    const targetId = jobId && jobId.trim().length > 0 ? jobId.trim() : 'general';
    const filePath = path.join(LOGS_DIR, `${targetId}.log`);
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${content}\n`;

    fs.appendFileSync(filePath, formattedMessage, 'utf-8');
  } catch (err) {
    console.error(`[TaskLogger] Error writing to log file:`, err);
  }
}

export interface LlmLogParams {
  jobId?: string | null;
  agentName: string;
  attempt: number;
  maxRetries: number;
  keyIndex: number;
  totalKeys: number;
  promptInput?: unknown;
  responseOutput?: unknown;
  error?: unknown;
  durationMs?: number;
  status: 'STARTED' | 'SUCCESS' | 'RETRY_429' | 'FAILED';
  sleepMs?: number;
}

export function logLlmCallToTaskFile(params: LlmLogParams): void {
  const {
    jobId,
    agentName,
    attempt,
    maxRetries,
    keyIndex,
    totalKeys,
    promptInput,
    responseOutput,
    error,
    durationMs,
    status,
    sleepMs,
  } = params;

  const header = `================================================================================
AGENT: [${agentName}] | STATUS: ${status} | ATTEMPT: ${attempt}/${maxRetries} | KEY: [Key ${keyIndex}/${totalKeys}]
--------------------------------------------------------------------------------`;

  let details = '';

  if (promptInput !== undefined) {
    const promptStr =
      typeof promptInput === 'string'
        ? promptInput
        : JSON.stringify(promptInput, null, 2);
    details += `\n[REQUEST BODY / PROMPT INPUT]\n${promptStr}\n`;
  }

  if (status === 'SUCCESS' && responseOutput !== undefined) {
    const responseStr =
      typeof responseOutput === 'string'
        ? responseOutput
        : JSON.stringify(responseOutput, null, 2);
    details += `\n[RESPONSE OUTPUT BODY] (${durationMs || 0}ms)\n${responseStr}\n`;
  }

  if (status === 'RETRY_429') {
    const errMessage = (error as Error)?.message || String(error || '');
    details += `\n[429 RATE LIMIT ERROR]\n${errMessage}\n[ACTION]: Sleeping for ${((sleepMs || 0) / 1000).toFixed(1)}s before rotating to next API key.\n`;
  }

  if (status === 'FAILED') {
    const errMessage = (error as Error)?.message || String(error || '');
    details += `\n[FATAL ERROR / ALL RETRIES EXHAUSTED]\n${errMessage}\n`;
  }

  const footer = `================================================================================\n`;

  const logContent = `${header}${details}${footer}`;
  logToTaskFile(jobId, logContent);
}
