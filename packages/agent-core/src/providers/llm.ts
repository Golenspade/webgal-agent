/**
 * LLM Provider - 支持多种LLM API的提供者
 * BYOK (Bring Your Own Key) 模式
 */

import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'qwen' | 'deepseek';
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string; // 用于支持自定义端点（如OpenRouter）
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export class LLMProvider {
  private config: LLMConfig;
  private anthropic?: Anthropic;
  private openai?: OpenAI;

  constructor(config: LLMConfig) {
    this.config = {
      temperature: 0.4,
      maxTokens: 4000,
      ...config,
    };

    if (this.config.provider === 'anthropic') {
      this.anthropic = new Anthropic({ apiKey: this.config.apiKey });
    } else if (this.config.provider === 'openai') {
      this.openai = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
      });
    }
  }

  /**
   * 调用LLM生成响应
   */
  async call(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      switch (this.config.provider) {
        case 'anthropic':
          return await this.callClaude(messages);
        case 'openai':
          return await this.callGPT(messages);
        case 'qwen':
        case 'deepseek':
          // 这些可以通过OpenAI兼容的API格式调用
          return await this.callGPT(messages);
        default:
          throw new Error(`Unsupported provider: ${this.config.provider}`);
      }
    } catch (error) {
      throw new Error(`LLM call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 调用Claude API
   */
  private async callClaude(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    // 分离system message
    const systemMessage = messages.find(m => m.role === 'system')?.content;
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await this.anthropic.messages.create({
      model: this.config.model || 'claude-3-5-sonnet-20241022',
      max_tokens: this.config.maxTokens || 4000,
      temperature: this.config.temperature || 0.4,
      system: systemMessage,
      messages: userMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    return {
      content: content.text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  /**
   * 调用GPT API（兼容OpenAI格式）
   */
  private async callGPT(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.openai.chat.completions.create({
      model: this.config.model || 'gpt-4-turbo-preview',
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: this.config.temperature || 0.4,
      max_tokens: this.config.maxTokens || 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from GPT');
    }

    return {
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
    };
  }
}
