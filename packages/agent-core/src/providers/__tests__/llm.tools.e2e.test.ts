/**
 * LLM Provider 工具调用端到端测试
 * 测试 LLM 的 function calling 能力
 *
 * 运行方式:
 *   DEEPSEEK_API_KEY=xxx yarn workspace @webgal-agent/agent-core test llm.tools.e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMProvider, LLMConfig, LLMTool, LLMMessage, LLMToolCall } from '../llm';

// 跳过条件：没有设置 API Key
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const shouldSkip = !DEEPSEEK_API_KEY;
const describeE2E = shouldSkip ? describe.skip : describe;

// 测试用工具定义
const testTools: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '获取指定城市的天气信息',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，例如：北京、上海',
          },
          unit: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: '温度单位',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: '执行数学计算',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: '数学表达式，例如：2+2, 10*5',
          },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取指定路径的文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件路径',
          },
        },
        required: ['path'],
      },
    },
  },
];

// 模拟工具执行
function executeToolCall(toolCall: LLMToolCall): string {
  const args = JSON.parse(toolCall.function.arguments);

  switch (toolCall.function.name) {
    case 'get_weather':
      return JSON.stringify({
        city: args.city,
        temperature: 22,
        unit: args.unit || 'celsius',
        condition: '晴天',
      });
    case 'calculate':
      try {
        // 简单的表达式计算（仅用于测试）
        const result = Function(`"use strict"; return (${args.expression})`)();
        return JSON.stringify({ result });
      } catch {
        return JSON.stringify({ error: '计算失败' });
      }
    case 'read_file':
      return JSON.stringify({
        path: args.path,
        content: '这是文件内容示例',
      });
    default:
      return JSON.stringify({ error: '未知工具' });
  }
}

describeE2E('LLMProvider 工具调用 E2E 测试', () => {
  let provider: LLMProvider;

  beforeAll(() => {
    const config: LLMConfig = {
      provider: 'deepseek',
      apiKey: DEEPSEEK_API_KEY!,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      temperature: 0.2,
      maxTokens: 1024,
    };
    provider = new LLMProvider(config);
  });

  it('应该识别需要调用天气工具', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个助手，可以使用工具来回答用户问题。当用户询问天气时，使用 get_weather 工具。',
      },
      {
        role: 'user',
        content: '北京今天天气怎么样？',
      },
    ];

    const response = await provider.call(messages, { tools: testTools });

    console.log('天气查询响应:', JSON.stringify(response, null, 2));

    // 应该返回工具调用
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls!.length).toBeGreaterThan(0);

    const weatherCall = response.toolCalls!.find(tc => tc.function.name === 'get_weather');
    expect(weatherCall).toBeDefined();

    const args = JSON.parse(weatherCall!.function.arguments);
    expect(args.city).toContain('北京');
  }, 30000);

  it('应该识别需要调用计算工具', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个助手，可以使用工具来回答用户问题。当用户需要计算时，使用 calculate 工具。',
      },
      {
        role: 'user',
        content: '帮我算一下 123 乘以 456 等于多少？',
      },
    ];

    const response = await provider.call(messages, { tools: testTools });

    console.log('计算响应:', JSON.stringify(response, null, 2));

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls!.length).toBeGreaterThan(0);

    const calcCall = response.toolCalls!.find(tc => tc.function.name === 'calculate');
    expect(calcCall).toBeDefined();

    const args = JSON.parse(calcCall!.function.arguments);
    expect(args.expression).toBeDefined();
  }, 30000);

  it('应该支持完整的工具调用循环', async () => {
    // 第一轮：用户提问
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个助手，可以使用工具来回答用户问题。回答要简洁。',
      },
      {
        role: 'user',
        content: '上海现在的天气如何？',
      },
    ];

    const response1 = await provider.call(messages, { tools: testTools });
    console.log('第一轮响应:', JSON.stringify(response1, null, 2));

    expect(response1.toolCalls).toBeDefined();
    const weatherCall = response1.toolCalls![0];
    expect(weatherCall.function.name).toBe('get_weather');

    // 执行工具
    const toolResult = executeToolCall(weatherCall);
    console.log('工具执行结果:', toolResult);

    // 第二轮：将工具结果返回给 LLM
    const messages2: LLMMessage[] = [
      ...messages,
      {
        role: 'assistant',
        content: response1.content || '',
        tool_calls: response1.toolCalls, // 必须包含 tool_calls
      },
      {
        role: 'tool',
        content: toolResult,
        tool_call_id: weatherCall.id,
        name: weatherCall.function.name,
      },
    ];

    const response2 = await provider.call(messages2, { tools: testTools });
    console.log('第二轮响应:', JSON.stringify(response2, null, 2));

    // 第二轮应该是文本响应
    expect(response2.content).toBeDefined();
    expect(response2.content.length).toBeGreaterThan(0);
    // 响应应该包含天气相关内容
    expect(response2.content).toMatch(/天气|温度|晴|度/);
  }, 60000);

  it('不需要工具时应该直接回答', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个助手，可以使用工具来回答用户问题。如果不需要工具就直接回答。',
      },
      {
        role: 'user',
        content: '你好，请用一句话介绍一下你自己。',
      },
    ];

    const response = await provider.call(messages, { tools: testTools });

    console.log('直接回答响应:', JSON.stringify(response, null, 2));

    // 不应该调用工具
    expect(response.toolCalls).toBeUndefined();
    // 应该有文本回复
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  }, 30000);

  it('应该正确解析工具参数', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个助手。当用户需要读取文件时，使用 read_file 工具。',
      },
      {
        role: 'user',
        content: '请读取 /home/user/config.json 这个文件',
      },
    ];

    const response = await provider.call(messages, { tools: testTools });

    console.log('文件读取响应:', JSON.stringify(response, null, 2));

    expect(response.toolCalls).toBeDefined();

    const readCall = response.toolCalls!.find(tc => tc.function.name === 'read_file');
    expect(readCall).toBeDefined();

    const args = JSON.parse(readCall!.function.arguments);
    expect(args.path).toContain('config.json');
  }, 30000);

  it('应该能处理多个工具调用', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个助手，可以使用多个工具来回答用户问题。如果需要多个工具，可以同时调用。',
      },
      {
        role: 'user',
        content: '帮我查一下北京和上海的天气',
      },
    ];

    const response = await provider.call(messages, { tools: testTools });

    console.log('多工具调用响应:', JSON.stringify(response, null, 2));

    // 可能一次调用多个工具，或分多次调用
    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls!.length).toBeGreaterThanOrEqual(1);

    // 所有调用都应该是 get_weather
    const weatherCalls = response.toolCalls!.filter(tc => tc.function.name === 'get_weather');
    expect(weatherCalls.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

// 如果没有配置 API Key，显示跳过原因
if (shouldSkip) {
  describe('LLMProvider 工具调用 E2E 测试 (跳过)', () => {
    it('跳过原因：未设置 DEEPSEEK_API_KEY 环境变量', () => {
      console.log('请设置 DEEPSEEK_API_KEY 环境变量后运行工具调用 E2E 测试');
      expect(true).toBe(true);
    });
  });
}
