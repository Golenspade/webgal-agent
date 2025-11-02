/**
 * Electron IPC 桥接层
 *
 * 暴露 MCP 工具调用给 Renderer 进程
 */

import type { IpcMain } from 'electron';
import { McpProcessManager, McpStartOptions } from './mcp-process-manager.js';
import { getPreviewPort, buildPreviewUrl } from './port-resolver.js';

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
}

// 导出单例
export const agentBridge = new AgentBridge();
