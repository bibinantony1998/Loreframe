import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { config } from '../config/env';

export interface CreateLLMOptions {
  requireJson?: boolean;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Dynamic LLM Provider Factory
 * Dynamically instantiates and returns either ChatOllama (Local) or ChatGoogleGenerativeAI (Cloud)
 * based on LLM_PROVIDER in process.env / config.
 */
export function createLLM(options: CreateLLMOptions = {}): BaseChatModel {
  const provider = config.llmProvider;
  const temperature = options.temperature ?? 0.7;

  if (provider === 'ollama') {
    const modelName = options.requireJson
      ? config.ollamaJsonModelName
      : config.ollamaModelName;

    return new ChatOllama({
      baseUrl: config.ollamaBaseUrl,
      model: modelName,
      format: options.requireJson ? 'json' : undefined,
      temperature: options.requireJson ? 0 : temperature,
    }) as unknown as BaseChatModel;
  }

  // Default: Google Gemini
  return new ChatGoogleGenerativeAI({
    model: config.geminiModel,
    apiKey: options.apiKey || config.googleApiKey,
    temperature: temperature,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: 0,
  }) as unknown as BaseChatModel;
}
