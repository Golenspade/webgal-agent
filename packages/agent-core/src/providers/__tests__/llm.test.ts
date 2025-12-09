/**
 * LLM Provider 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { LLMProvider, LLMConfig, LLMMessage, LLMResponse } from '../llm'

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}))

// Mock OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}))

import { Anthropic } from '@anthropic-ai/sdk'
import OpenAI from 'openai'

describe('LLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('构造函数', () => {
    it('应该正确初始化 Anthropic 提供者', () => {
      const config: LLMConfig = {
        provider: 'anthropic',
        apiKey: 'test-anthropic-key',
        model: 'claude-3-5-sonnet-20241022',
      }

      const provider = new LLMProvider(config)
      expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' })
      expect(provider).toBeDefined()
    })

    it('应该正确初始化 OpenAI 提供者', () => {
      const config: LLMConfig = {
        provider: 'openai',
        apiKey: 'test-openai-key',
        model: 'gpt-4-turbo-preview',
      }

      const provider = new LLMProvider(config)
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-openai-key',
        baseURL: undefined,
      })
      expect(provider).toBeDefined()
    })

    it('应该正确初始化 Qwen 提供者 (OpenAI 兼容)', () => {
      const config: LLMConfig = {
        provider: 'qwen',
        apiKey: 'test-qwen-key',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      }

      const provider = new LLMProvider(config)
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-qwen-key',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      })
      expect(provider).toBeDefined()
    })

    it('应该正确初始化 DeepSeek 提供者 (OpenAI 兼容)', () => {
      const config: LLMConfig = {
        provider: 'deepseek',
        apiKey: 'test-deepseek-key',
        baseURL: 'https://api.deepseek.com',
      }

      const provider = new LLMProvider(config)
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-deepseek-key',
        baseURL: 'https://api.deepseek.com',
      })
      expect(provider).toBeDefined()
    })

    it('应该使用默认参数', () => {
      const config: LLMConfig = {
        provider: 'anthropic',
        apiKey: 'test-key',
      }

      const provider = new LLMProvider(config)
      // 默认 temperature 为 0.4，maxTokens 为 4000
      expect(provider).toBeDefined()
    })
  })

  describe('call() - Anthropic 提供者', () => {
    let provider: LLMProvider
    let mockAnthropicCreate: Mock

    beforeEach(() => {
      mockAnthropicCreate = vi.fn()
      ;(Anthropic as unknown as Mock).mockImplementation(() => ({
        messages: {
          create: mockAnthropicCreate,
        },
      }))

      provider = new LLMProvider({
        provider: 'anthropic',
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
      })
    })

    it('应该正确调用 Claude API 并返回响应', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: '你好！我是 Claude 助手。' }],
        usage: {
          input_tokens: 10,
          output_tokens: 15,
        },
      })

      const messages: LLMMessage[] = [
        { role: 'system', content: '你是一个有帮助的助手。' },
        { role: 'user', content: '你好' },
      ]

      const response = await provider.call(messages)

      expect(response.content).toBe('你好！我是 Claude 助手。')
      expect(response.usage).toEqual({
        inputTokens: 10,
        outputTokens: 15,
        totalTokens: 25,
      })
    })

    it('应该正确分离 system message', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      })

      const messages: LLMMessage[] = [
        { role: 'system', content: '系统提示词' },
        { role: 'user', content: '用户消息' },
        { role: 'assistant', content: '助手回复' },
        { role: 'user', content: '后续问题' },
      ]

      await provider.call(messages)

      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: '系统提示词',
          messages: [
            { role: 'user', content: '用户消息' },
            { role: 'assistant', content: '助手回复' },
            { role: 'user', content: '后续问题' },
          ],
        }),
      )
    })

    it('应该处理工具调用响应（非纯文本响应）', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tool_1', name: 'get_weather', input: { city: '北京' } }],
        usage: { input_tokens: 5, output_tokens: 5 },
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      const response = await provider.call(messages)

      // 现在支持工具调用，不再抛出错误
      expect(response.content).toBe('')
      expect(response.toolCalls).toBeDefined()
      expect(response.toolCalls?.[0].id).toBe('tool_1')
    })

    it('应该处理 API 错误', async () => {
      mockAnthropicCreate.mockRejectedValue(new Error('API rate limit exceeded'))

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      await expect(provider.call(messages)).rejects.toThrow(
        'LLM call failed: API rate limit exceeded',
      )
    })
  })

  describe('call() - OpenAI 提供者', () => {
    let provider: LLMProvider
    let mockOpenAICreate: Mock

    beforeEach(() => {
      mockOpenAICreate = vi.fn()
      ;(OpenAI as unknown as Mock).mockImplementation(() => ({
        chat: {
          completions: {
            create: mockOpenAICreate,
          },
        },
      }))

      provider = new LLMProvider({
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4-turbo-preview',
      })
    })

    it('应该正确调用 GPT API 并返回响应', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '你好！我是 GPT 助手。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 12,
          total_tokens: 22,
        },
      })

      const messages: LLMMessage[] = [
        { role: 'system', content: '你是一个有帮助的助手。' },
        { role: 'user', content: '你好' },
      ]

      const response = await provider.call(messages)

      expect(response.content).toBe('你好！我是 GPT 助手。')
      expect(response.usage).toEqual({
        inputTokens: 10,
        outputTokens: 12,
        totalTokens: 22,
      })
    })

    it('应该使用正确的参数调用 API', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      })

      const messages: LLMMessage[] = [
        { role: 'system', content: '系统' },
        { role: 'user', content: '用户' },
      ]

      await provider.call(messages)

      expect(mockOpenAICreate).toHaveBeenCalledWith({
        model: 'gpt-4-turbo-preview',
        messages: messages,
        temperature: 0.4,
        max_tokens: 4000,
      })
    })

    it('应该处理空响应（返回空内容而非抛错）', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      // 空响应现在不再抛出错误，因为可能有 tool_calls
      const response = await provider.call(messages)
      expect(response.content).toBe('')
      expect(response.toolCalls).toBeUndefined()
    })

    it('应该处理没有 choices 的响应（返回空内容）', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [],
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      // 空 choices 现在返回空内容
      const response = await provider.call(messages)
      expect(response.content).toBe('')
    })

    it('应该处理 API 错误', async () => {
      mockOpenAICreate.mockRejectedValue(new Error('Invalid API key'))

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      await expect(provider.call(messages)).rejects.toThrow('LLM call failed: Invalid API key')
    })

    it('应该处理缺少 usage 信息的响应', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'Response without usage' } }],
        // 没有 usage 字段
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      const response = await provider.call(messages)

      expect(response.content).toBe('Response without usage')
      expect(response.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
    })
  })

  describe('call() - Qwen 提供者', () => {
    let provider: LLMProvider
    let mockOpenAICreate: Mock

    beforeEach(() => {
      mockOpenAICreate = vi.fn()
      ;(OpenAI as unknown as Mock).mockImplementation(() => ({
        chat: {
          completions: {
            create: mockOpenAICreate,
          },
        },
      }))

      provider = new LLMProvider({
        provider: 'qwen',
        apiKey: 'test-qwen-key',
        model: 'qwen-turbo',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      })
    })

    it('应该使用 OpenAI 兼容 API 调用 Qwen', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '来自通义千问的回复' } }],
        usage: { prompt_tokens: 8, completion_tokens: 10, total_tokens: 18 },
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '你好' }]

      const response = await provider.call(messages)

      expect(response.content).toBe('来自通义千问的回复')
      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen-turbo',
        }),
      )
    })
  })

  describe('call() - DeepSeek 提供者', () => {
    let provider: LLMProvider
    let mockOpenAICreate: Mock

    beforeEach(() => {
      mockOpenAICreate = vi.fn()
      ;(OpenAI as unknown as Mock).mockImplementation(() => ({
        chat: {
          completions: {
            create: mockOpenAICreate,
          },
        },
      }))

      provider = new LLMProvider({
        provider: 'deepseek',
        apiKey: 'test-deepseek-key',
        model: 'deepseek-chat',
        baseURL: 'https://api.deepseek.com',
      })
    })

    it('应该使用 OpenAI 兼容 API 调用 DeepSeek', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '来自 DeepSeek 的回复' } }],
        usage: { prompt_tokens: 8, completion_tokens: 10, total_tokens: 18 },
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '你好' }]

      const response = await provider.call(messages)

      expect(response.content).toBe('来自 DeepSeek 的回复')
      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'deepseek-chat',
        }),
      )
    })
  })

  describe('错误处理', () => {
    it('应该处理不支持的提供者类型', async () => {
      const config = {
        provider: 'unknown-provider' as any,
        apiKey: 'test-key',
      }

      const provider = new LLMProvider(config)
      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      await expect(provider.call(messages)).rejects.toThrow(
        'LLM call failed: Unsupported provider: unknown-provider',
      )
    })

    it('应该处理非 Error 类型的异常', async () => {
      const mockCreate = vi.fn().mockRejectedValue('字符串错误')
      ;(Anthropic as unknown as Mock).mockImplementation(() => ({
        messages: { create: mockCreate },
      }))

      const provider = new LLMProvider({
        provider: 'anthropic',
        apiKey: 'test-key',
      })

      const messages: LLMMessage[] = [{ role: 'user', content: '测试' }]

      await expect(provider.call(messages)).rejects.toThrow('LLM call failed: 字符串错误')
    })
  })

  describe('配置验证', () => {
    it('应该允许自定义 temperature', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      ;(OpenAI as unknown as Mock).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }))

      const provider = new LLMProvider({
        provider: 'openai',
        apiKey: 'test-key',
        temperature: 0.8,
      })

      await provider.call([{ role: 'user', content: '测试' }])

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.8,
        }),
      )
    })

    it('应该允许自定义 maxTokens', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
      ;(OpenAI as unknown as Mock).mockImplementation(() => ({
        chat: { completions: { create: mockCreate } },
      }))

      const provider = new LLMProvider({
        provider: 'openai',
        apiKey: 'test-key',
        maxTokens: 8000,
      })

      await provider.call([{ role: 'user', content: '测试' }])

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 8000,
        }),
      )
    })
  })
})

/**
 * Mock LLM Provider - 用于其他模块测试
 */
export class MockLLMProvider {
  private responses: LLMResponse[] = []
  private callHistory: LLMMessage[][] = []
  private defaultResponse: string

  constructor(defaultResponse = 'Mock LLM response') {
    this.defaultResponse = defaultResponse
  }

  /**
   * 设置下一次调用的响应
   */
  setNextResponse(response: Partial<LLMResponse>): void {
    this.responses.push({
      content: response.content ?? this.defaultResponse,
      usage: response.usage ?? {
        inputTokens: 10,
        outputTokens: 10,
        totalTokens: 20,
      },
    })
  }

  /**
   * 模拟 call 方法
   */
  async call(messages: LLMMessage[]): Promise<LLMResponse> {
    this.callHistory.push([...messages])
    return (
      this.responses.shift() ?? {
        content: this.defaultResponse,
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
        },
      }
    )
  }

  /**
   * 获取调用历史
   */
  getCallHistory(): LLMMessage[][] {
    return this.callHistory
  }

  /**
   * 获取最后一次调用
   */
  getLastCall(): LLMMessage[] | undefined {
    return this.callHistory[this.callHistory.length - 1]
  }

  /**
   * 获取调用次数
   */
  getCallCount(): number {
    return this.callHistory.length
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.responses = []
    this.callHistory = []
  }
}
