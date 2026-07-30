import { config } from '../config/env';
import { logLlmCallToTaskFile, logToTaskFile } from './taskLogger';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class APIKeyManager {
  private apiKeys: string[];
  private currentIndex: number = 0;

  constructor(keys?: string[]) {
    this.apiKeys = keys && keys.length > 0 ? keys : config.googleApiKeys;
    if (this.apiKeys.length === 0 || !this.apiKeys[0]) {
      console.warn('[APIKeyManager] ⚠️ No Google API keys found in environment. Using fallback empty string.');
      this.apiKeys = [''];
    }
    console.log(`[APIKeyManager] Initialized with ${this.apiKeys.length} API key(s) for load balancing.`);

    // Startup check to warn if API keys are identical or share exact prefixes
    this.verifyKeyUniqueness();
  }

  private verifyKeyUniqueness(): void {
    if (this.apiKeys.length <= 1) return;

    const uniqueKeys = new Set(this.apiKeys.filter((k) => k.length > 0));
    if (uniqueKeys.size < this.apiKeys.length) {
      console.warn(
        `[APIKeyManager] ⚠️ WARNING: Detected duplicate Google API keys in environment. Rotating identical keys will NOT bypass rate limits! Ensure keys are created in separate Google Cloud/AI Studio projects.`
      );
    }

    // Check if keys share identical key structures/prefixes (heuristic check)
    const prefixes = this.apiKeys.map((k) => k.substring(0, 12));
    const uniquePrefixes = new Set(prefixes);
    if (uniquePrefixes.size < prefixes.length) {
      console.warn(
        `[APIKeyManager] ⚠️ NOTICE: Multiple API keys share identical prefixes (${Array.from(uniquePrefixes).join(', ')}). Please verify each key belongs to a distinct Google Cloud project with independent quota limits.`
      );
    }
  }

  public getNextKey(): { apiKey: string; keyIndex: number; totalKeys: number } {
    const keyIndex = this.currentIndex;
    const apiKey = this.apiKeys[keyIndex];
    const totalKeys = this.apiKeys.length;

    // Advance to next key for round-robin rotation
    this.currentIndex = (this.currentIndex + 1) % totalKeys;

    return { apiKey, keyIndex: keyIndex + 1, totalKeys };
  }

  public get totalKeys(): number {
    return this.apiKeys.length;
  }
}

export const apiKeyManager = new APIKeyManager();

function parseRetryDelayMs(error: unknown): number | null {
  const errObj = error as Record<string, unknown> | undefined;
  const errMessage = (error as Error)?.message || String(error || '');

  // 1. Direct number properties
  if (typeof errObj?.retryDelay === 'number') {
    return errObj.retryDelay as number;
  }
  if (typeof errObj?.retryAfter === 'number') {
    return (errObj.retryAfter as number) * 1000;
  }

  // 2. String property or message parsing (e.g. "retryDelay":"15s", "Please retry after 15s", "retryDelay": 15000)
  const secMatch = errMessage.match(/(?:retryDelay|retryAfter|retry\s+after)["']?\s*[:=]?\s*["']?(\d+(?:\.\d+)?)s/i);
  if (secMatch && secMatch[1]) {
    return Math.ceil(parseFloat(secMatch[1]) * 1000);
  }

  const msMatch = errMessage.match(/(?:retryDelay|retryAfter)["']?\s*[:=]?\s*["']?(\d+)ms/i);
  if (msMatch && msMatch[1]) {
    return parseInt(msMatch[1], 10);
  }

  return null;
}

class RateLimiter {
  private totalCalls = 0;

  public getStats() {
    return {
      totalCalls: this.totalCalls,
    };
  }

  public async execute<T>(
    llmCallFn: (apiKey: string) => Promise<T>,
    agentName: string = 'Agent',
    jobId?: string | null,
    promptInput?: unknown
  ): Promise<T> {
    this.totalCalls++;

    console.log(
      `[RateLimiter] [${agentName}] Initiating LLM Call #${this.totalCalls}`
    );

    // 1. Check Batch Cooldown Limit
    if (this.totalCalls > 1 && (this.totalCalls - 1) % config.llmBatchSize === 0) {
      console.log(
        `[RateLimiter] ⏳ Batch limit of ${config.llmBatchSize} calls reached. Pausing for ${
          config.llmCooldownMs / 1000
        }s cooldown...`
      );
      if (jobId) {
        logToTaskFile(
          jobId,
          `[RateLimiter] ⏳ Batch limit of ${config.llmBatchSize} calls reached. Pausing for ${config.llmCooldownMs / 1000}s cooldown...`
        );
      }
      await sleep(config.llmCooldownMs);
      console.log(`[RateLimiter] 🚀 Cooldown finished. Resuming LLM executions...`);
    } else if (this.totalCalls > 1) {
      // 2. Baseline inter-call delay to maintain safe RPM
      console.log(
        `[RateLimiter] Applying baseline pause of ${
          config.llmCallDelayMs / 1000
        }s between calls...`
      );
      await sleep(config.llmCallDelayMs);
    }

    // 3. Retry loop for LLM calls with API Key Rotation on 429 / Rate Limit
    const maxRetries = config.llmMaxRetries;
    let currentBackoffMs = config.llmCallDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const { apiKey, keyIndex, totalKeys } = apiKeyManager.getNextKey();
      console.log(
        `[RateLimiter] [${agentName}] Executing request (Attempt ${attempt}/${maxRetries}) using [Key ${keyIndex}/${totalKeys}]...`
      );

      const startTime = Date.now();

      try {
        const result = await llmCallFn(apiKey);
        const durationMs = Date.now() - startTime;

        console.log(
          `[RateLimiter] [${agentName}] Call #${this.totalCalls} completed successfully with [Key ${keyIndex}/${totalKeys}].`
        );

        // Write complete request & response logs to task log file
        logLlmCallToTaskFile({
          jobId,
          agentName,
          attempt,
          maxRetries,
          keyIndex,
          totalKeys,
          promptInput,
          responseOutput: result,
          durationMs,
          status: 'SUCCESS',
        });

        return result;
      } catch (error) {
        const errMessage = (error as Error)?.message || String(error);
        const isRateLimitError =
          errMessage.includes('429') ||
          errMessage.includes('RESOURCE_EXHAUSTED') ||
          errMessage.toLowerCase().includes('quota exceeded') ||
          errMessage.toLowerCase().includes('too many requests');

        if (isRateLimitError && attempt < maxRetries) {
          // Parse retry delay or fallback to exponential backoff / default cooldown
          const parsedDelay = parseRetryDelayMs(error);
          let sleepMs = config.llmCooldownMs;

          if (parsedDelay !== null) {
            sleepMs = Math.max(parsedDelay, config.llmCooldownMs);
          } else {
            currentBackoffMs = Math.max(config.llmCooldownMs, currentBackoffMs * 2);
            sleepMs = currentBackoffMs;
          }

          const sleepSec = (sleepMs / 1000).toFixed(1);
          console.warn(
            `[RateLimiter] Swallowing 429 error on Attempt ${attempt}/${maxRetries} using [Key ${keyIndex}/${totalKeys}]. Sleeping for ${sleepSec} seconds before trying next key...`
          );

          // Write 429 retry details to task log file
          logLlmCallToTaskFile({
            jobId,
            agentName,
            attempt,
            maxRetries,
            keyIndex,
            totalKeys,
            promptInput,
            error,
            status: 'RETRY_429',
            sleepMs,
          });

          await sleep(sleepMs);
          // Continuation of loop automatically rotates key on next iteration
        } else {
          console.error(
            `[RateLimiter] ❌ [${agentName}] Execution failed on attempt ${attempt}/${maxRetries} using [Key ${keyIndex}/${totalKeys}]:`,
            errMessage
          );

          // Write fatal failure to task log file
          logLlmCallToTaskFile({
            jobId,
            agentName,
            attempt,
            maxRetries,
            keyIndex,
            totalKeys,
            promptInput,
            error,
            status: 'FAILED',
          });

          throw error;
        }
      }
    }

    throw new Error(`[RateLimiter] Exceeded max retries (${maxRetries}) for ${agentName}`);
  }
}

export const globalRateLimiter = new RateLimiter();

export async function executeWithRateLimit<T>(
  llmCallFn: (apiKey: string) => Promise<T>,
  agentName: string = 'Agent',
  jobId?: string | null,
  promptInput?: unknown
): Promise<T> {
  return globalRateLimiter.execute(llmCallFn, agentName, jobId, promptInput);
}
