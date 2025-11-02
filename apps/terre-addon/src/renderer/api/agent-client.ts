/**
 * Renderer 侧 Agent IPC 客户端
 * 
 * 封装与主进程的 IPC 通信
 */

import type { McpStartOptions } from '../../main/mcp-process-manager.js';
import type {
  Diff,
  ValidateScriptResponse,
  ListProjectResourcesResponse,
  ReadFileResponse,
  SearchFilesResponse,
  ReplaceInFileResponse,
  WriteToFileResponse,
  ListFilesResponse,
} from '@webgal-agent/agent-core/types';

// 类型定义（与 CONTRACTS.md 对齐）
export interface ToolError {
  error: {
    code: string;
    message: string;
    details?: any;
    hint?: string;
    recoverable?: boolean;
  };
}

export type ListFilesResult = ListFilesResponse;

export type ReadFileResult = ReadFileResponse;

export type WriteDryRunResult = { applied: false; diff: Diff };

export type WriteApplyResult = { applied: true; snapshotId: string; bytesWritten: number };

export type ValidateResult = ValidateScriptResponse;

export type ProjectResources = ListProjectResourcesResponse;

export interface AgentStatus {
  running: boolean;
  projectRoot: string | null;
  tools: Array<{ name: string; description?: string }>;
  previewPort: number;
}

/**
 * Agent IPC 客户端
 */
export class AgentClient {
  /**
   * 设置项目根（启动 MCP）
   */
  async setProjectRoot(projectRoot: string, options?: McpStartOptions): Promise<void> {
    const result = await this.invoke('agent:setProjectRoot', { projectRoot, options });
    if (result.error) {
      throw result.error;
    }
  }

  /**
   * 获取状态
   */
  async getStatus(): Promise<AgentStatus> {
    const result = await this.invoke<AgentStatus>('agent:getStatus');
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 列出场景文件
   */
  async listScenes(): Promise<ListFilesResult> {
    const result = await this.invoke<ListFilesResult | ToolError>('agent:listScenes');
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 读取文件
   */
  async readFile(path: string): Promise<ReadFileResult> {
    const result = await this.invoke<ReadFileResult | ToolError>('agent:readFile', { path });
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * Dry-run 写入
   */
  async writeDryRun(args: {
    path: string;
    content: string;
    mode?: 'overwrite' | 'append';
  }): Promise<WriteDryRunResult> {
    const result = await this.invoke<WriteDryRunResult | ToolError>('agent:writeDryRun', args);
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 应用写入
   */
  async writeApply(args: {
    path: string;
    content: string;
    mode?: 'overwrite' | 'append';
    idempotencyKey?: string;
  }): Promise<WriteApplyResult> {
    const result = await this.invoke<WriteApplyResult | ToolError>('agent:writeApply', args);
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 文件内替换
   */
  async replaceInFile(args: {
    path: string;
    find: string;
    replace: string;
    flags?: string;
  }): Promise<ReplaceInFileResponse> {
    const result = await this.invoke<ReplaceInFileResponse | ToolError>('agent:replaceInFile', args);
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 搜索文件
   */
  async searchFiles(args: {
    path: string;
    regex: string;
    filePattern?: string;
    maxMatches?: number;
  }): Promise<SearchFilesResponse> {
    const result = await this.invoke<SearchFilesResponse | ToolError>('agent:searchFiles', args);
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 校验脚本
   */
  async validateScript(args: { path?: string; content?: string }): Promise<ValidateResult> {
    const result = await this.invoke<ValidateResult | ToolError>('agent:validateScript', args);
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 列出项目资源
   */
  async listProjectResources(): Promise<ProjectResources> {
    const result = await this.invoke<ProjectResources | ToolError>('agent:listProjectResources');
    if ('error' in result) {
      throw result.error;
    }
    return result;
  }

  /**
   * 获取预览 URL
   */
  async getPreviewUrl(scenePath?: string): Promise<string> {
    const result = await this.invoke<{ url: string } | ToolError>('agent:previewUrl', { scenePath });
    if ('error' in result) {
      throw result.error;
    }
    return result.url;
  }

  /**
   * 停止 MCP
   */
  async stop(): Promise<void> {
    const result = await this.invoke('agent:stop');
    if (result.error) {
      throw result.error;
    }
  }

  /**
   * 通用 IPC 调用
   */
  private async invoke<T = any>(channel: string, payload?: any): Promise<T> {
    // 在 Electron Renderer 中使用 window.electron.ipcRenderer.invoke
    // 这里假设已经通过 preload 脚本暴露了 window.electron
    if (typeof window !== 'undefined' && (window as any).electron) {
      return (window as any).electron.ipcRenderer.invoke(channel, payload);
    }
    
    // 开发环境 Mock（可选）
    console.warn(`[AgentClient] IPC not available, mocking call to ${channel}`);
    throw new Error('IPC not available');
  }
}

// 导出单例
export const agentClient = new AgentClient();
