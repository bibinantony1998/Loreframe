import { config } from '../config/env';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class RateLimiter {
  private totalCalls = 0;
  private currentBatchCount = 0;

  public getStats() {
    return {
      totalCalls: this.totalCalls,
      currentBatchCount: this.currentBatchCount,
    };
  }

  public async execute<T>(llmCallFn: () => Promise<T>, agentName: string = 'Agent'): Promise<T> {
    this.totalCalls++;
    this.currentBatchCount++;

    console.log(`[RateLimiter] [${agentName}] Initiating Call #${this.totalCalls} (Batch: ${this.currentBatchCount}/${config.llmBatchSize})`);

    // 1. Batch Cooldown Check
    if (this.currentBatchCount > 1 && (this.currentBatchCount - 1) % config.llmBatchSize === 0) {
      console.log(
        `[RateLimiter] ⏳ Batch limit of ${config.llmBatchSize} calls reached. Pausing for ${config.llmCooldownMs / 1000}s cooldown...`
      );
      await sleep(config.llmCooldownMs);
      console.log(`[RateLimiter] 🚀 Cooldown finished. Resuming agent executions...`);
      this.currentBatchCount = 1;
    } else if (this.totalCalls > 1) {
      // 2. Baseline inter-call delay to maintain safe RPM
      console.log(`[RateLimiter] Applying baseline pause of ${config.llmCallDelayMs / 1000}s between calls...`);
      await sleep(config.llmCallDelayMs);
    }

    // 3. Retry loop for 429 / Rate Limit errors
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[RateLimiter] [${agentName}] Executing LLM API request (Attempt ${attempt}/${maxRetries})...`);
        const result = await llmCallFn();
        console.log(`[RateLimiter] [${agentName}] Call #${this.totalCalls} completed successfully.`);
        return result;
      } catch (error) {
        const errMessage = (error as Error).message || String(error);
        const isRateLimitError =
          errMessage.includes('429') ||
          errMessage.includes('RESOURCE_EXHAUSTED') ||
          errMessage.toLowerCase().includes('quota exceeded') ||
          errMessage.toLowerCase().includes('too many requests');

        if (isRateLimitError && attempt < maxRetries) {
          const retryDelayMs = config.llmCooldownMs;
          console.warn(
            `[RateLimiter] ⚠️ [429 Quota Exceeded] [${agentName}] Rate limit encountered on attempt ${attempt}/${maxRetries}. Sleeping ${retryDelayMs / 1000}s before retry...`
          );
          await sleep(retryDelayMs);
          console.log(`[RateLimiter] Retrying ${agentName} call after 429 cooldown (Attempt ${attempt + 1}/${maxRetries})...`);
        } else {
          console.error(`[RateLimiter] ❌ [${agentName}] Execution failed after attempt ${attempt}:`, errMessage);
          throw error;
        }
      }
    }

    throw new Error(`[RateLimiter] Exceeded max retries for ${agentName}`);
  }
}

export const globalRateLimiter = new RateLimiter();

export async function executeWithRateLimit<T>(
  llmCallFn: () => Promise<T>,
  agentName: string = 'Agent'
): Promise<T> {
  return globalRateLimiter.execute(llmCallFn, agentName);
}
