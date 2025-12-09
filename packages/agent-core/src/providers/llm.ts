/**
 * LLM Provider - 支持多种LLM API的提供者
 * BYOK (Bring Your Own Key) 模式
 * 支持的提供商：anthropic, openai, qwen(阿里云), deepseek
 * qwen 和 deepseek 使用 OpenAI 兼容的 API 格式
 */

import { Anthropic } from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'qwen' | 'deepseek'
  apiKey: string
  model?: string
  temperature?: number
  maxTokens?: number
  baseURL?: string // 用于支持自定义端点（如OpenRouter、阿里云、DeepSeek）
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string // for tool messages (function name)
  tool_call_id?: string // for tool result messages
  tool_calls?: LLMToolCall[] // for assistant messages with tool calls
}

export interface LLMTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string // JSON string of arguments
  }
}

export interface LLMCallOptions {
  tools?: LLMTool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

export interface LLMResponse {
  content: string
  toolCalls?: LLMToolCall[]
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export class LLMProvider {
  private config: LLMConfig
  private anthropic?: Anthropic
  private openai?: OpenAI

  constructor(config: LLMConfig) {
    this.config = {
      temperature: 0.4,
      maxTokens: 4000,
      ...config,
    }

    if (this.config.provider === 'anthropic') {
      this.anthropic = new Anthropic({ apiKey: this.config.apiKey })
    } else if (
      this.config.provider === 'openai' ||
      this.config.provider === 'qwen' ||
      this.config.provider === 'deepseek'
    ) {
      // OpenAI 兼容的提供商（OpenAI, Qwen, DeepSeek）共用同一个 OpenAI client
      this.openai = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
      })
    }
  }

  /**
   * 调用LLM生成响应
   */
  async call(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    try {
      switch (this.config.provider) {
        case 'anthropic':
          return await this.callClaude(messages, options)
        case 'openai':
          return await this.callGPT(messages, options)
        case 'qwen':
        case 'deepseek':
          // 这些可以通过OpenAI兼容的API格式调用
          return await this.callGPT(messages, options)
        default:
          throw new Error(`Unsupported provider: ${this.config.provider}`)
      }
    } catch (error) {
      throw new Error(`LLM call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 调用Claude API
   */
  private async callClaude(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized')
    }

    // 分离system message
    const systemMessage = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    // 转换工具格式为 Anthropic 格式
    const tools = options?.tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: {
        type: 'object' as const,
        properties: (t.function.parameters as Record<string, unknown>)?.properties || {},
        required: (t.function.parameters as Record<string, unknown>)?.required || [],
      },
    }))

    const response = await this.anthropic.messages.create({
      model: this.config.model || 'claude-3-5-sonnet-20241022',
      max_tokens: this.config.maxTokens || 4000,
      temperature: this.config.temperature || 0.4,
      system: systemMessage,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(tools && tools.length > 0 ? { tools } : {}),
    })

    // 处理工具调用
    const toolCalls: LLMToolCall[] = []
    let textContent = ''

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        })
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    }
  }

  /**
   * 调用GPT API（兼容OpenAI格式）
   */
  private async callGPT(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMResponse> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized')
    }

    // 构建请求参数
    const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.config.model || 'gpt-4-turbo-preview',
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: this.config.temperature || 0.4,
      max_tokens: this.config.maxTokens || 4000,
    }

    // 添加工具
    if (options?.tools && options.tools.length > 0) {
      requestParams.tools = options.tools as OpenAI.Chat.ChatCompletionTool[]
      if (options.tool_choice) {
        requestParams.tool_choice =
          options.tool_choice as OpenAI.Chat.ChatCompletionToolChoiceOption
      } else {
        requestParams.tool_choice = 'auto'
      }
    }

    const response = await this.openai.chat.completions.create(requestParams)

    const message = response.choices[0]?.message
    const content = message?.content || ''

    // 处理工具调用
    const toolCalls = message?.tool_calls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }))

    return {
      content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
    }
  }
}
