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
  
  // LLM Provider Selection: "gemini" | "ollama"
  llmProvider: (process.env.LLM_PROVIDER || 'gemini').toLowerCase() as 'gemini' | 'ollama',
  
  // Ollama Configuration
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModelName: process.env.OLLAMA_MODEL_NAME || 'llama3.1:8b',
  ollamaJsonModelName: process.env.OLLAMA_JSON_MODEL_NAME || 'llama3.1:8b',
  
  // Image Provider Configuration: "comfyui" | "gemini"
  imageProvider: (process.env.IMAGE_PROVIDER || 'comfyui').toLowerCase() as 'comfyui' | 'gemini',
  comfyuiBaseUrl: process.env.COMFYUI_BASE_URL || 'http://localhost:8188',
  
  // TTS Provider Configuration: "kokoro" | "gcp"
  ttsProvider: (process.env.TTS_PROVIDER || 'kokoro').toLowerCase() as 'kokoro' | 'gcp',
  kokoroBaseUrl: process.env.KOKORO_BASE_URL || 'http://localhost:8880/v1/audio/speech',
  kokoroVoice: process.env.KOKORO_VOICE || 'am_adam',
  
  // Rate Limiting & Cooldown Configuration
  llmBatchSize: parseInt(process.env.LLM_BATCH_SIZE || '5', 10),
  llmCooldownMs: parseInt(process.env.LLM_COOLDOWN_MS || '15000', 10),
  llmCallDelayMs: parseInt(process.env.LLM_CALL_DELAY_MS || '3000', 10),
  llmMaxRetries: parseInt(process.env.LLM_MAX_RETRIES || '4', 10),
};
