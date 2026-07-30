import dotenv from 'dotenv';
dotenv.config();

// Parse all configured Google API key variants from process.env
const googleApiKeys: string[] = [];
if (process.env.GOOGLE_API_KEY) googleApiKeys.push(process.env.GOOGLE_API_KEY);
for (let i = 1; i <= 10; i++) {
  const key = process.env[`GOOGLE_API_KEY${i}`];
  if (key) googleApiKeys.push(key);
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  googleApiKeys: googleApiKeys.length > 0 ? googleApiKeys : [''],
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  
  // Rate Limiting & Cooldown Configuration
  llmBatchSize: parseInt(process.env.LLM_BATCH_SIZE || '5', 10),
  llmCooldownMs: parseInt(process.env.LLM_COOLDOWN_MS || '15000', 10),
  llmCallDelayMs: parseInt(process.env.LLM_CALL_DELAY_MS || '3000', 10),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || '4', 10),
};
