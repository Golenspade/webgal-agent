/**
 * WebGAL Agent 端到端测试
 * 
 * 测试 LLM 实际调用工具来操作 WebGAL 场景文件
 * 
 * 运行方式:
 *   DEEPSEEK_API_KEY=xxx yarn workspace @webgal-agent/agent-core test webgal-agent-e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { LLMProvider, type LLMConfig, type LLMMessage, type LLMTool, type LLMToolCall } from '../../providers/llm.js';
import { WebGALAgentTools, type ToolsConfig } from '../index.js';

// 跳过条件：没有设置 API Key
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const shouldSkip = !DEEPSEEK_API_KEY;
const describeE2E = shouldSkip ? describe.skip : describe;

if (shouldSkip) {
  console.log('请设置 DEEPSEEK_API_KEY 环境变量后运行 WebGAL Agent E2E 测试');
}

// WebGAL 工具定义（供 LLM 调用）
const webgalTools: LLMTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出目录中的文件和子目录',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的文件路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_to_file',
      description: '写入或创建文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: '在文件中查找并替换文本',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          find: { type: 'string', description: '要查找的文本' },
          replace: { type: 'string', description: '替换为的文本' },
          flags: { type: 'string', description: '正则标志，如 g 表示全局替换' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_script',
      description: '校验 WebGAL 脚本语法',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '脚本文件路径' },
          content: { type: 'string', description: '脚本内容（与 path 二选一）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_project_resources',
      description: '列出项目中的所有资源（背景/立绘/BGM/语音/场景）',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

describeE2E('WebGAL Agent E2E 测试 - LLM 调用工具操作场景', () => {
  let llmProvider: LLMProvider;
  let tools: WebGALAgentTools;
  let testProjectRoot: string;

  // 执行工具调用
  async function executeToolCall(toolCall: LLMToolCall): Promise<string> {
    const args = JSON.parse(toolCall.function.arguments);
    
    try {
      let result: any;
      
      switch (toolCall.function.name) {
        case 'list_files':
          result = await tools.listFiles({ path: args.path });
          break;
        case 'read_file':
          result = await tools.readFile({ path: args.path });
          break;
        case 'write_to_file':
          result = await tools.writeToFile({
            path: args.path,
            content: args.content,
            dryRun: false,
          });
          break;
        case 'replace_in_file':
          result = await tools.replaceInFile({
            path: args.path,
            find: args.find,
            replace: args.replace,
            flags: args.flags || 'g',
          });
          break;
        case 'validate_script':
          result = await tools.validateScript({
            path: args.path,
            content: args.content,
          });
          break;
        case 'list_project_resources':
          result = await tools.listProjectResources();
          break;
        default:
          result = { error: `未知工具: ${toolCall.function.name}` };
      }
      
      return JSON.stringify(result);
    } catch (error: any) {
      return JSON.stringify({ error: error.message || String(error) });
    }
  }

  // Agentic Loop: 循环调用 LLM 直到完成
  async function agenticLoop(
    initialMessages: LLMMessage[],
    maxSteps: number = 10
  ): Promise<{ messages: LLMMessage[]; finalResponse: string }> {
    let messages = [...initialMessages];
    
    for (let step = 0; step < maxSteps; step++) {
      console.log(`\n🔄 步骤 ${step + 1}...`);
      
      const response = await llmProvider.call(messages, { tools: webgalTools });
      
      // 如果没有工具调用，返回最终回复
      if (!response.toolCalls || response.toolCalls.length === 0) {
        console.log('✅ LLM 完成任务');
        return { messages, finalResponse: response.content || '' };
      }
      
      // 添加 assistant 消息
      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });
      
      // 执行每个工具调用
      for (const toolCall of response.toolCalls) {
        console.log(`  🔧 调用工具: ${toolCall.function.name}`);
        console.log(`     参数: ${toolCall.function.arguments}`);
        
        const result = await executeToolCall(toolCall);
        console.log(`     结果: ${result.substring(0, 200)}${result.length > 200 ? '...' : ''}`);
        
        // 添加工具结果
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        });
      }
    }
    
    throw new Error('达到最大步数限制');
  }

  beforeAll(async () => {
    // 创建测试项目目录
    testProjectRoot = path.join(os.tmpdir(), `webgal-e2e-${Date.now()}`);
    
    await fs.mkdir(testProjectRoot, { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'scene'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'background'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'figure'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'bgm'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, '.webgal_agent', 'snapshots'), { recursive: true });

    // 创建初始场景文件
    await fs.writeFile(
      path.join(testProjectRoot, 'game', 'scene', 'start.txt'),
      `changeBg:bg_room.png -next;
小明:早上好！今天天气真不错。;
小红:是啊，我们去公园玩吧！;
changeFigure:xiaoming_happy.png -left;
小明:好主意！;
`
    );

    // 创建资源文件
    await fs.writeFile(path.join(testProjectRoot, 'game', 'background', 'bg_room.png'), 'fake');
    await fs.writeFile(path.join(testProjectRoot, 'game', 'background', 'bg_park.png'), 'fake');
    await fs.writeFile(path.join(testProjectRoot, 'game', 'figure', 'xiaoming_happy.png'), 'fake');

    // 初始化 LLM Provider
    const llmConfig: LLMConfig = {
      provider: 'deepseek',
      apiKey: DEEPSEEK_API_KEY!,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      temperature: 0.3,
      maxTokens: 2048,
    };
    llmProvider = new LLMProvider(llmConfig);

    // 初始化工具
    const toolsConfig: ToolsConfig = {
      projectRoot: testProjectRoot,
      sandbox: {
        projectRoot: testProjectRoot,
        forbiddenDirs: ['.git', 'node_modules', '.env'],
        maxReadBytes: 1048576,
        textEncoding: 'utf-8',
      },
      snapshotRetention: 10,
    };
    tools = new WebGALAgentTools(toolsConfig);

    console.log(`\n📁 测试项目目录: ${testProjectRoot}`);
  });

  afterAll(async () => {
    try {
      await fs.rm(testProjectRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('清理测试目录失败:', e);
    }
  });

  it('应该让 LLM 读取并理解场景文件', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个 WebGAL 视觉小说脚本助手。你可以使用工具来读取和修改场景文件。
WebGAL 脚本格式：
- 对话: 角色名:对话内容;
- 切换背景: changeBg:背景文件名 -next;
- 切换立绘: changeFigure:立绘文件名 -left/-right;
请使用工具完成任务。`,
      },
      {
        role: 'user',
        content: '请读取 game/scene/start.txt 文件，告诉我这个场景里有哪些角色在对话？',
      },
    ];

    const { finalResponse } = await agenticLoop(messages);
    
    console.log('\n📝 最终回复:', finalResponse);
    
    // 验证 LLM 识别出了角色
    expect(finalResponse).toMatch(/小明|小红/);
  }, 60000);

  it('应该让 LLM 创建新的场景文件', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个 WebGAL 视觉小说脚本助手。你可以使用工具来读取和修改场景文件。
WebGAL 脚本格式：
- 对话: 角色名:对话内容;
- 切换背景: changeBg:背景文件名 -next;
- 切换立绘: changeFigure:立绘文件名 -left/-right;
请使用工具完成任务。`,
      },
      {
        role: 'user',
        content: '请在 game/scene/ 目录下创建一个新场景 chapter2.txt，内容是：小明和小红到了公园，看到了美丽的风景，两人开心地聊天。请用正确的 WebGAL 格式编写。',
      },
    ];

    const { finalResponse } = await agenticLoop(messages);
    
    console.log('\n📝 最终回复:', finalResponse);
    
    // 验证文件已创建
    const content = await fs.readFile(
      path.join(testProjectRoot, 'game', 'scene', 'chapter2.txt'),
      'utf-8'
    );
    
    console.log('\n📄 创建的文件内容:\n', content);
    
    expect(content).toContain('小明');
    expect(content).toContain('小红');
    expect(content).toMatch(/changeBg|:.*;/); // 包含 WebGAL 语法
  }, 60000);

  it('应该让 LLM 修改现有场景文件', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个 WebGAL 视觉小说脚本助手。你可以使用工具来读取和修改场景文件。
WebGAL 脚本格式：
- 对话: 角色名:对话内容;
- 切换背景: changeBg:背景文件名 -next;
- 切换立绘: changeFigure:立绘文件名 -left/-right;
请使用工具完成任务。`,
      },
      {
        role: 'user',
        content: '请读取 game/scene/start.txt，然后把所有的"小明"替换成"阿明"，并验证修改后的脚本是否正确。',
      },
    ];

    const { finalResponse } = await agenticLoop(messages);
    
    console.log('\n📝 最终回复:', finalResponse);
    
    // 验证文件已修改
    const content = await fs.readFile(
      path.join(testProjectRoot, 'game', 'scene', 'start.txt'),
      'utf-8'
    );
    
    console.log('\n📄 修改后的文件内容:\n', content);
    
    expect(content).toContain('阿明');
    expect(content).not.toContain('小明');
  }, 60000);

  it('应该让 LLM 列出并分析项目资源', async () => {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个 WebGAL 视觉小说脚本助手。你可以使用工具来读取和修改场景文件。`,
      },
      {
        role: 'user',
        content: '请列出项目中的所有资源，告诉我有哪些背景图、立绘和场景文件。',
      },
    ];

    const { finalResponse } = await agenticLoop(messages);
    
    console.log('\n📝 最终回复:', finalResponse);
    
    // 验证 LLM 列出了资源
    expect(finalResponse).toMatch(/bg_room|bg_park|background|场景|start/i);
  }, 60000);
});
