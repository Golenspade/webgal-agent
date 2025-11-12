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
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import type { ResolvedConfig } from './config.js';
import { checkLock } from './lock-manager.js';

export interface ServerConfig extends ResolvedConfig {
  projectRoot: string;
  policiesPath?: string;
  verbose?: boolean;
}

/**
 * 创建 MCP 服务器实例
 */
export async function createMCPServer(config: ServerConfig) {
  // 结构化日志工具
  const log = (level: 'INFO'|'ERROR'|'DEBUG', component: string, message: string, data?: Record<string, unknown>) => {
    const entry: any = { ts: new Date().toISOString(), level, component, message };
    if (data) entry.data = data;
    try {
      console.error(JSON.stringify(entry));
    } catch {
      console.error(`[${level}] [${component}] ${message}`);
    }
  };

  const server = new Server(
    {
      name: 'webgal-agent-mcpserver',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
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
    idempotency: config.idempotency,
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
      name: 'list_snapshots',
      description: '列出快照（按时间降序）',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '最大返回数量（默认 50）' },
          path: { type: 'string', description: '按路径过滤（startsWith 匹配）' },
        },
      },
    },
    {
      name: 'restore_snapshot',
      description: '恢复快照内容',
      inputSchema: {
        type: 'object',
        properties: {
          snapshotId: { type: 'string', description: '快照 ID' },
        },
        required: ['snapshotId'],
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
    {
      name: 'get_runtime_info',
      description: '获取当前 MCP 服务器的运行时环境信息和策略配置',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
  // Verbose: report registered tools count
  if (config.verbose) {
    log('INFO', 'MCP', 'tools registered', { count: toolDefinitions.length });
  }

  // ===== Prompts capability =====
  const promptRegistry = [
    {
      name: 'webgal.create_scene',
      description: 'Create a new WebGAL scene script with background, figures, and dialogue',
      arguments: [
        { name: 'sceneName', description: 'Scene file name, e.g., beach_date.txt', required: true },
      ],
    },
    {
      name: 'webgal.refactor_scene',
      description: 'Refactor or improve an existing WebGAL scene file',
      arguments: [
        { name: 'path', description: 'Scene file path under game/scene', required: true },
        { name: 'goal', description: 'Refactor goal, e.g., add -next, adjust pacing', required: false },
      ],
    },
    {
      name: 'webgal.fix_validation',
      description: 'Fix validate_script diagnostics for a given scene',
      arguments: [
        { name: 'path', description: 'Scene file path', required: true },
        { name: 'diagnostics', description: 'JSON diagnostics array from validate_script', required: false },
      ],
    },
  ] as const;

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: promptRegistry.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params as any;
    const notFound = () => {
      throw new Error(`Unknown prompt: ${name}`);
    };

    switch (name) {
      case 'webgal.create_scene': {
        const sceneName = args?.sceneName || 'new_scene.txt';
        return {
          description: 'Create a WebGAL scene script',
          messages: [
            {
              role: 'system',
              content: { type: 'text', text: 'You are a WebGAL script assistant. Output only valid WebGAL lines using English colon and semicolon.' },
            },
            {
              role: 'user',
              content: { type: 'text', text: `Create scene ${sceneName} with minimal dialogue and proper -next usage where needed.` },
            },
          ],
        };
      }
      case 'webgal.refactor_scene': {
        const path = args?.path || 'game/scene/start.txt';
        const goal = args?.goal || 'improve pacing and add -next after stage changes';
        return {
          description: 'Refactor WebGAL scene',
          messages: [
            { role: 'system', content: { type: 'text', text: 'You are a WebGAL refactoring assistant. Keep syntax valid and minimal changes.' } },
            { role: 'user', content: { type: 'text', text: `Refactor ${path}. Goal: ${goal}. Show a suggested patch or replacement lines.` } },
          ],
        };
      }
      case 'webgal.fix_validation': {
        const path = args?.path || 'game/scene/start.txt';
        const diagnostics = args?.diagnostics ? JSON.stringify(args.diagnostics) : '[]';
        return {
          description: 'Fix validation diagnostics',
          messages: [
            { role: 'system', content: { type: 'text', text: 'You fix WebGAL validation issues: semicolons, allowed commands, resource existence.' } },
            { role: 'user', content: { type: 'text', text: `File: ${path}\nDiagnostics: ${diagnostics}\nReturn corrected lines only.` } },
          ],
        };
      }
      default:
        return notFound();
    }
  });


  // 注册 list_tools 处理器
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  // 注册 call_tool 处理器
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const started = Date.now();
    const withTimeout = async <T>(p: Promise<T>, timeoutMs = 30000): Promise<T> => {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject({
          error: { code: 'E_TIMEOUT', message: `Operation timed out: ${name}`, details: { timeoutMs, opId } }
        }), timeoutMs))
      ]);
    };

    try {
      let result: any;

      switch (name) {
        case 'list_files':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.listFiles(args as any));
          break;
        case 'read_file':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.readFile(args as any));
          break;
        case 'write_to_file':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.writeToFile(args as any));
          break;
        case 'replace_in_file':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.replaceInFile(args as any));
          break;
        case 'search_files':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.searchFiles(args as any), 45000);
          break;
        case 'validate_script':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.validateScript(args as any));
          break;
        case 'list_project_resources':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.listProjectResources());
          break;
        case 'list_snapshots':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.listSnapshots(args as any));
          break;
        case 'restore_snapshot':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.restoreSnapshot(args as any));
          break;
        case 'preview_scene':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.previewScene(args as any), 60000);
          break;
        case 'ask_followup_question':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.askFollowupQuestion(args as any));
          break;
        case 'attempt_completion':
          log('INFO', 'tool', 'start', { opId, name });
          result = await withTimeout(tools.attemptCompletion(args as any));
          break;
        case 'get_runtime_info':
          // 直接在 MCP 层返回运行时信息（不涉及工具层）
          const lock = await checkLock(config.projectRoot);
          result = {
            projectRoot: config.projectRoot,
            snapshotRetention: config.snapshotRetention,
            sandbox: {
              forbiddenDirs: config.sandbox.forbiddenDirs,
              maxReadBytes: config.sandbox.maxReadBytes,
              textEncoding: config.sandbox.textEncoding,
            },
            ...(config.policiesPath && { policiesPath: config.policiesPath }),
            ...(config.execution && {
              execution: {
                enabled: true,
                allowedCommands: config.execution.allowedCommands,
                timeoutMs: config.execution.timeoutMs,
                ...(config.execution.workingDir && { workingDir: config.execution.workingDir }),
              },
            }),
            ...(config.browser && {
              browser: {
                enabled: true,
                allowedHosts: config.browser.allowedHosts,
                timeoutMs: config.browser.timeoutMs,
                ...(config.browser.screenshotDir && { screenshotDir: config.browser.screenshotDir }),
              },
            }),
            ...(lock && { lock }),
            tools: toolDefinitions.map((t) => t.name),
            server: {
              name: 'webgal-agent-mcpserver',
              version: '0.1.0',
            },
          };
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const duration = Date.now() - started;
      log('INFO', 'tool', 'success', { opId, name, durationMs: duration });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      const duration = Date.now() - started;
      log('ERROR', 'tool', 'error', { opId, name, durationMs: duration, error: (error?.error || error)?.message || String(error) });
      // 统一错误处理：符合 CONTRACTS.md 错误模型
      const toolError = (error && error.error)
        ? error
        : {
            error: {
              code: 'E_INTERNAL' as any,
              message: error?.message || 'Internal error',
              details: error?.stack,
              opId,
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
  console.error(`[MCP] ready (stdio)`);
}
