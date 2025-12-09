/**
 * LLM Provider 端到端测试
 * 使用真实的 API 调用来测试 LLM 提供者
 *
 * 需要设置环境变量：
 * - LLM_API_KEY: API 密钥
 * - LLM_BASE_URL: API 基础 URL（可选，用于 OpenAI 兼容的服务）
 * - LLM_MODEL: 模型名称（可选）
 * - LLM_PROVIDER: 提供者类型（anthropic | openai | qwen | deepseek），默认自动检测
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { LLMProvider, LLMConfig, LLMMessage } from '../llm'

// 从环境变量读取配置
function getConfigFromEnv(): LLMConfig | null {
  // 支持多种环境变量名称
  const apiKey =
    process.env.LLM_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  let baseURL = process.env.LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL
  let model = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL
  let provider = process.env.LLM_PROVIDER as LLMConfig['provider'] | undefined

  if (!apiKey) {
    return null
  }

  // 根据使用的环境变量自动设置 provider 和 baseURL
  if (!provider) {
    if (process.env.DEEPSEEK_API_KEY) {
      provider = 'deepseek'
      // 自动设置 DeepSeek 的 baseURL
      if (!baseURL) {
        baseURL = 'https://api.deepseek.com/v1'
      }
      // 自动设置 DeepSeek 的默认模型
      if (!model) {
        model = 'deepseek-chat'
      }
    }
  }

  // 根据 provider 自动设置默认 baseURL 和 model
  if (provider === 'deepseek') {
    if (!baseURL) {
      baseURL = 'https://api.deepseek.com/v1'
    }
    if (!model) {
      model = 'deepseek-chat'
    }
  } else if (provider === 'qwen' && !baseURL) {
    baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  }

  // 自动检测提供者
  if (!provider) {
    if (baseURL?.includes('deepseek')) {
      provider = 'deepseek'
    } else if (baseURL?.includes('dashscope') || baseURL?.includes('aliyun')) {
      provider = 'qwen'
    } else if (baseURL?.includes('anthropic') || apiKey.startsWith('sk-ant-')) {
      provider = 'anthropic'
    } else {
      provider = 'openai' // 默认使用 OpenAI 兼容格式
    }
  }

  return {
    provider,
    apiKey,
    baseURL,
    model,
  }
}

describe('LLMProvider E2E Tests', () => {
  let config: LLMConfig | null

  beforeAll(() => {
    config = getConfigFromEnv()
  })

  describe('真实 API 调用', () => {
    it('应该成功调用 LLM 并获取响应', async () => {
      if (!config) {
        console.log('⚠️ 跳过测试：未设置 LLM_API_KEY 环境变量')
        return
      }

      console.log(`\n🔧 测试配置:`)
      console.log(`   Provider: ${config.provider}`)
      console.log(`   Model: ${config.model || '(默认)'}`)
      console.log(`   Base URL: ${config.baseURL || '(默认)'}`)

      const provider = new LLMProvider(config)

      const messages: LLMMessage[] = [
        { role: 'system', content: '你是一个简洁的助手，用中文回答，回复控制在20字以内。' },
        { role: 'user', content: '1+1等于几？' },
      ]

      console.log(`\n📤 发送消息: "${messages[1].content}"`)

      const startTime = Date.now()
      const response = await provider.call(messages)
      const duration = Date.now() - startTime

      console.log(`\n📥 收到响应 (${duration}ms):`)
      console.log(`   内容: "${response.content}"`)
      if (response.usage) {
        console.log(
          `   Token 使用: 输入=${response.usage.inputTokens}, 输出=${response.usage.outputTokens}, 总计=${response.usage.totalTokens}`,
        )
      }

      // 验证响应
      expect(response.content).toBeTruthy()
      expect(response.content.length).toBeGreaterThan(0)
      expect(response.content).toMatch(/2|二|两/) // 应该包含正确答案
    }, 30000) // 30秒超时

    it('应该正确处理多轮对话', async () => {
      if (!config) {
        console.log('⚠️ 跳过测试：未设置 LLM_API_KEY 环境变量')
        return
      }

      const provider = new LLMProvider(config)

      const messages: LLMMessage[] = [
        { role: 'system', content: '你是一个数学助手，用中文回答，回复简洁。' },
        { role: 'user', content: '我有3个苹果' },
        { role: 'assistant', content: '好的，你有3个苹果。' },
        { role: 'user', content: '我又买了2个，现在有几个？' },
      ]

      console.log(`\n📤 多轮对话测试...`)

      const response = await provider.call(messages)

      console.log(`📥 响应: "${response.content}"`)

      expect(response.content).toBeTruthy()
      expect(response.content).toMatch(/5|五/) // 应该包含正确答案
    }, 30000)

    it('应该正确处理中文内容', async () => {
      if (!config) {
        console.log('⚠️ 跳过测试：未设置 LLM_API_KEY 环境变量')
        return
      }

      const provider = new LLMProvider(config)

      const messages: LLMMessage[] = [{ role: 'user', content: '用一个成语形容"非常开心"' }]

      console.log(`\n📤 中文测试: "${messages[0].content}"`)

      const response = await provider.call(messages)

      console.log(`📥 响应: "${response.content}"`)

      expect(response.content).toBeTruthy()
      // 中文成语通常是4个字
      expect(response.content.length).toBeGreaterThan(0)
    }, 30000)
  })

  describe('错误处理', () => {
    it('应该处理无效的 API Key', async () => {
      const invalidConfig: LLMConfig = {
        provider: 'openai',
        apiKey: 'invalid-key-12345',
        baseURL: config?.baseURL,
        model: config?.model,
      }

      const provider = new LLMProvider(invalidConfig)

      await expect(provider.call([{ role: 'user', content: '测试' }])).rejects.toThrow()
    }, 30000)
  })
})

/**
 * 运行说明：
 *
 * 1. 设置环境变量后运行：
 *    LLM_API_KEY=your-key LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-chat yarn test llm.e2e
 *
 * 2. 或者创建 .env 文件（需要 dotenv 支持）
 *
 * 3. 支持的提供者：
 *    - anthropic: Claude 系列模型
 *    - openai: GPT 系列模型
 *    - qwen: 通义千问（阿里云）
 *    - deepseek: DeepSeek 模型
 */
