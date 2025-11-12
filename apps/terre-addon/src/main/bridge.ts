/**
 * Electron IPC 桥接层
 *
 * 暴露 MCP 工具调用给 Renderer 进程
 */

import type { IpcMain } from 'electron';
import { McpProcessManager, McpStartOptions } from './mcp-process-manager.js';
import { getPreviewPort, buildPreviewUrl } from './port-resolver.js';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

export class AgentBridge {
  private mcpManager: McpProcessManager;
  private ipcMain: IpcMain | null = null;

  constructor() {
    this.mcpManager = new McpProcessManager();

    // 监听 MCP 进程事件
    this.mcpManager.on('exit', (code) => {
      console.log('[AgentBridge] MCP process exited:', code);
    });

    this.mcpManager.on('error', (error) => {
      console.error('[AgentBridge] MCP process error:', error);
    });
  }

  /**
   * 注册 IPC 处理器
   */
  registerIpcHandlers(ipcMain: IpcMain) {
    this.ipcMain = ipcMain;

    // 设置项目根（启动 MCP）
    ipcMain.handle('agent:setProjectRoot', async (_event, args: {
      projectRoot: string;
      options?: McpStartOptions;
    }) => {
      try {
        // 停止现有进程
        await this.mcpManager.stop();

        // 启动新进程
        await this.mcpManager.start(args.projectRoot, args.options || {});

        return { success: true };
      } catch (error: any) {
        return { error: { code: 'E_INTERNAL', message: error.message } };
      }
    });

    // 获取状态
    ipcMain.handle('agent:getStatus', async () => {
      try {
        const status = this.mcpManager.getStatus();
        const tools = status.running ? await this.mcpManager.listTools() : [];

        return {
          ...status,
          tools,
          previewPort: getPreviewPort(),
        };
      } catch (error: any) {
        return { error: { code: 'E_INTERNAL', message: error.message } };
      }
    });

    // 列出场景文件
    ipcMain.handle('agent:listScenes', async () => {
      try {
        const result = await this.mcpManager.callTool('list_files', {
          path: 'game/scene',
        });
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 读取文件
    ipcMain.handle('agent:readFile', async (_event, args: { path: string }) => {
      try {
        const result = await this.mcpManager.callTool('read_file', {
          path: args.path,
        });
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // Dry-run 写入
    ipcMain.handle('agent:writeDryRun', async (_event, args: {
      path: string;
      content: string;
      mode?: 'overwrite' | 'append';
    }) => {
      try {
        const result = await this.mcpManager.callTool('write_to_file', {
          path: args.path,
          content: args.content,
          mode: args.mode || 'overwrite',
          dryRun: true,
        });
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 应用写入
    ipcMain.handle('agent:writeApply', async (_event, args: {
      path: string;
      content: string;
      mode?: 'overwrite' | 'append';
      idempotencyKey?: string;
    }) => {
      try {
        const result = await this.mcpManager.callTool('write_to_file', {
          path: args.path,
          content: args.content,
          mode: args.mode || 'overwrite',
          dryRun: false,
          idempotencyKey: args.idempotencyKey,
        });
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 文件内替换
    ipcMain.handle('agent:replaceInFile', async (_event, args: {
      path: string;
      find: string;
      replace: string;
      flags?: string;
    }) => {
      try {
        const result = await this.mcpManager.callTool('replace_in_file', args);
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 搜索文件
    ipcMain.handle('agent:searchFiles', async (_event, args: {
      path: string;
      regex: string;
      filePattern?: string;
      maxMatches?: number;
    }) => {
      try {
        const result = await this.mcpManager.callTool('search_files', args);
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 校验脚本
    ipcMain.handle('agent:validateScript', async (_event, args: {
      path?: string;
      content?: string;
    }) => {
      try {
        const result = await this.mcpManager.callTool('validate_script', args);
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 列出项目资源
    ipcMain.handle('agent:listProjectResources', async () => {
      try {
        const result = await this.mcpManager.callTool('list_project_resources', {});
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 列出快照
    ipcMain.handle('agent:listSnapshots', async (_event, args: { path?: string; limit?: number }) => {
      try {
        const result = await this.mcpManager.callTool('list_snapshots', {
          ...(args?.path ? { path: args.path } : {}),
          ...(args?.limit !== undefined ? { limit: args.limit } : {}),
        });
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 恢复快照
    ipcMain.handle('agent:restoreSnapshot', async (_event, args: { snapshotId: string }) => {
      try {
        const result = await this.mcpManager.callTool('restore_snapshot', {
          snapshotId: args.snapshotId,
        });
        return result;
      } catch (error: any) {
        return { error };
      }
    });

    // 获取预览 URL
    ipcMain.handle('agent:previewUrl', async (_event, args?: { scenePath?: string }) => {
      try {
        const url = buildPreviewUrl(args?.scenePath);
        return { url };
      } catch (error: any) {
        return { error: { code: 'E_INTERNAL', message: error.message } };
      }
    });

    // 停止 MCP
    ipcMain.handle('agent:stop', async () => {
      try {
        await this.mcpManager.stop();
        return { success: true };
      } catch (error: any) {
        return { error: { code: 'E_INTERNAL', message: error.message } };
      }
    });
  }

  /**
   * 清理资源（应用退出时调用）
   */
  async cleanup() {
    await this.mcpManager.stop();
  }

  /**
   * 应用启动时自动拉起 MCP（可通过环境变量配置）
   *
   * 环境变量：
   * - WEBGAL_AGENT_AUTOSTART=0|1（默认 1）
   * - WEBGAL_PROJECT_ROOT=</abs/path>
   * - WEBGAL_POLICIES=</abs/path/to/policies.json>
   * - WEBGAL_ENABLE_EXEC=0|1
   * - WEBGAL_ENABLE_BROWSER=0|1
   * - WEBGAL_SNAPSHOT_RETENTION=<num>
   */
  async autostart() {
    try {
      const shouldAutostart = parseBool(process.env.WEBGAL_AGENT_AUTOSTART, true);
      if (!shouldAutostart) {
        console.log('[AgentBridge] Autostart disabled by WEBGAL_AGENT_AUTOSTART');
        return;
      }

      // 解析项目根：优先环境变量，否则使用当前工作目录
      const projectRoot = process.env.WEBGAL_PROJECT_ROOT
        ? resolve(process.env.WEBGAL_PROJECT_ROOT)
        : process.cwd();

      // 解析策略文件：优先环境变量；否则探测常见位置
      let policiesPath = process.env.WEBGAL_POLICIES ? resolve(process.env.WEBGAL_POLICIES) : undefined;
      if (!policiesPath) {
        const candidates = [
          join(projectRoot, 'configs', 'policies.json'),
          join(projectRoot, 'policies.json'),
        ];
        for (const p of candidates) {
          if (existsSync(p)) {
            policiesPath = p;
            break;
          }
        }
      }

      const options: McpStartOptions = {
        policiesPath,
        enableExec: parseBool(process.env.WEBGAL_ENABLE_EXEC, false),
        enableBrowser: parseBool(process.env.WEBGAL_ENABLE_BROWSER, false),
        snapshotRetention: parseNumber(process.env.WEBGAL_SNAPSHOT_RETENTION),
      };

      console.log('[AgentBridge] Autostart MCP with projectRoot:', projectRoot, 'options:', {
        ...options,
        // 避免在日志中泄露完整路径或敏感信息（这里只是示例，按需裁剪）
      });

      await this.mcpManager.start(projectRoot, options);
      console.log('[AgentBridge] MCP started');
    } catch (error: any) {
      console.warn('[AgentBridge] MCP autostart failed:', error?.message || error);
    }
  }
}

// 导出单例
export const agentBridge = new AgentBridge();

function parseBool(v: string | undefined, defaultValue = false): boolean {
  if (v === undefined) return defaultValue;
  const s = String(v).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return defaultValue;
}

function parseNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
