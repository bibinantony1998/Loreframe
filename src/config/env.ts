import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  redisHost: process.env.REDIS_HOST || 'localhost',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
  
  // Rate Limiting & Cooldown Configuration
  llmBatchSize: parseInt(process.env.LLM_BATCH_SIZE || '5', 10),
  llmCooldownMs: parseInt(process.env.LLM_COOLDOWN_MS || '60000', 10),
  llmCallDelayMs: parseInt(process.env.LLM_CALL_DELAY_MS || '5000', 10),
};
