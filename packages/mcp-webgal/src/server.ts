/**
 * MCP Server for WebGAL Agent
 *
 * 通过 stdio 暴露工具集，符合 Model Context Protocol 规范
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import type { ResolvedConfig } from './config.js';

export interface ServerConfig extends ResolvedConfig {
  projectRoot: string;
  policiesPath?: string;
}

/**
 * 创建 MCP 服务器实例
 */
export async function createMCPServer(config: ServerConfig) {
  const server = new Server(
    {
      name: 'webgal-agent',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 初始化 WebGAL Agent Tools（使用已合并的配置）
  const tools = new WebGALAgentTools({
    projectRoot: config.projectRoot,
    sandbox: {
      ...config.sandbox,
      projectRoot: config.projectRoot,
    },
    execution: config.execution,
    browser: config.browser,
    snapshotRetention: config.snapshotRetention,
  });

  // 定义工具列表
  const toolDefinitions: Tool[] = [
    {
      name: 'list_files',
      description: '列出目录中的文件和子目录',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的路径' },
          globs: {
            type: 'array',
            items: { type: 'string' },
            description: 'glob 模式数组（可选）',
          },
          dirsOnly: { type: 'boolean', description: '仅列出目录（可选）' },
        },
        required: ['path'],
      },
    },
    {
      name: 'read_file',
      description: '读取文件内容',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的文件路径' },
          maxBytes: { type: 'number', description: '最大读取字节数（可选）' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_to_file',
      description: '写入文件（支持 dry-run 预览 diff）',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的文件路径' },
          content: { type: 'string', description: '文件内容' },
          mode: { type: 'string', enum: ['overwrite', 'append'], description: '写入模式（默认 overwrite）' },
          dryRun: { type: 'boolean', description: 'true=仅返回 diff，false=实际写入' },
          idempotencyKey: { type: 'string', description: '幂等性键（可选）' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'replace_in_file',
      description: '在文件中查找并替换文本',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对于项目根的文件路径' },
          find: { type: 'string', description: '要查找的文本或正则表达式' },
          replace: { type: 'string', description: '替换文本' },
          flags: { type: 'string', description: '正则标志（如 g, i, m）' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
    {
      name: 'search_files',
      description: '在文件中搜索匹配的文本',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '搜索起始路径' },
          regex: { type: 'string', description: '搜索正则表达式' },
          filePattern: { type: 'string', description: 'glob 文件模式（可选）' },
          maxMatches: { type: 'number', description: '最大匹配数（可选）' },
        },
        required: ['path', 'regex'],
      },
    },
    {
      name: 'validate_script',
      description: '校验 WebGAL 脚本语法和资源引用',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '脚本文件路径（可选，与 content 二选一）' },
          content: { type: 'string', description: 'WebGAL 脚本内容' },
          scenePath: { type: 'string', description: '场景文件路径（用于资源检查，可选）' },
        },
        required: [],
      },
    },
    {
      name: 'list_project_resources',
      description: '列出项目中的所有资源（背景/立绘/BGM/语音/场景）',
      inputSchema: {
        type: 'object',
        properties: {
          extensions: {
            type: 'object',
            description: '自定义扩展名过滤（可选）',
          },
        },
      },
    },
    {
      name: 'preview_scene',
      description: '启动 dev 服务器并返回场景预览 URL',
      inputSchema: {
        type: 'object',
        properties: {
          scenePath: { type: 'string', description: '场景文件路径' },
        },
        required: ['scenePath'],
      },
    },
    {
      name: 'ask_followup_question',
      description: '向用户询问后续问题（占位）',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题内容' },
        },
        required: ['question'],
      },
    },
    {
      name: 'attempt_completion',
      description: '尝试完成任务（占位）',
      inputSchema: {
        type: 'object',
        properties: {
          result: { type: 'string', description: '任务结果' },
        },
        required: ['result'],
      },
    },
  ];

  // 注册 list_tools 处理器
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  // 注册 call_tool 处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: any;

      switch (name) {
        case 'list_files':
          result = await tools.listFiles(args as any);
          break;
        case 'read_file':
          result = await tools.readFile(args as any);
          break;
        case 'write_to_file':
          result = await tools.writeToFile(args as any);
          break;
        case 'replace_in_file':
          result = await tools.replaceInFile(args as any);
          break;
        case 'search_files':
          result = await tools.searchFiles(args as any);
          break;
        case 'validate_script':
          result = await tools.validateScript(args as any);
          break;
        case 'list_project_resources':
          result = await tools.listProjectResources();
          break;
        case 'preview_scene':
          result = await tools.previewScene(args as any);
          break;
        case 'ask_followup_question':
          result = await tools.askFollowupQuestion(args as any);
          break;
        case 'attempt_completion':
          result = await tools.attemptCompletion(args as any);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      // 统一错误处理：符合 CONTRACTS.md 错误模型
      const toolError = (error && error.error)
        ? error
        : {
            error: {
              code: 'E_INTERNAL' as any,
              message: error?.message || 'Internal error',
              details: error?.stack,
            },
          };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(toolError, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * 启动 stdio 服务器
 */
export async function startServer(config: ServerConfig) {
  const server = await createMCPServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 启动信息已在 bin.ts 中输出，这里仅保留协议层日志
  console.error(`✅ MCP Server ready (stdio)`);
}
