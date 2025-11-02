/**
 * MCP 子进程管理器
 * 
 * 以子进程方式启动 mcp-webgal，维护 stdio 通道，提供 JSON-RPC 封装
 */

import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { EventEmitter } from 'events';

export interface McpStartOptions {
  policiesPath?: string;
  enableExec?: boolean;
  enableBrowser?: boolean;
  snapshotRetention?: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: any;
}

/**
 * MCP 子进程管理器
 */
export class McpProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private projectRoot: string | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }>();
  private buffer = '';

  /**
   * 启动 MCP 子进程
   */
  async start(projectRoot: string, opts: McpStartOptions = {}): Promise<void> {
    if (this.process) {
      throw new Error('MCP process already running');
    }

    this.projectRoot = projectRoot;

    // 构造启动参数
    const args = ['--project', projectRoot];
    
    if (opts.policiesPath) {
      args.push('--policies', opts.policiesPath);
    }
    
    if (opts.snapshotRetention !== undefined) {
      args.push('--retention', String(opts.snapshotRetention));
    }
    
    if (opts.enableExec) {
      args.push('--enable-exec');
    }
    
    if (opts.enableBrowser) {
      args.push('--enable-browser');
    }

    // 查找 mcp-webgal 可执行文件
    const mcpBin = this.resolveMcpBin();

    console.log('[McpProcessManager] Starting MCP:', mcpBin, args);

    // 启动子进程（使用 tsx 运行 TypeScript 源码）
    const command = mcpBin.endsWith('.ts') ? 'tsx' : 'node';
    this.process = spawn(command, [mcpBin, ...args], {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: projectRoot,
    });

    // 监听输出
    this.process.stdout?.on('data', (data) => {
      this.handleStdout(data);
    });

    // 监听退出
    this.process.on('close', (code) => {
      console.log(`[McpProcessManager] Process exited with code ${code}`);
      this.cleanup();
      this.emit('exit', code);
    });

    this.process.on('error', (error) => {
      console.error('[McpProcessManager] Process error:', error);
      this.emit('error', error);
    });

    // 等待初始化（发送 initialize 请求）
    await this.initialize();
  }

  /**
   * 停止 MCP 子进程
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    console.log('[McpProcessManager] Stopping MCP process');
    
    this.process.kill('SIGTERM');
    
    // 等待退出（最多 5 秒）
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          console.warn('[McpProcessManager] Force killing process');
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.process?.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.cleanup();
  }

  /**
   * 调用 MCP 工具
   */
  async callTool<T = any>(name: string, args?: any): Promise<T> {
    if (!this.process) {
      throw new Error('MCP process not running');
    }

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args || {},
    });

    // 检查是否是错误响应
    if (response.content?.[0]?.text) {
      try {
        const parsed = JSON.parse(response.content[0].text);
        if (parsed.error) {
          throw parsed.error;
        }
        return parsed as T;
      } catch (e) {
        // 如果不是 JSON，直接返回
        return response as T;
      }
    }

    return response as T;
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<Tool[]> {
    if (!this.process) {
      throw new Error('MCP process not running');
    }

    const response = await this.sendRequest('tools/list', {});
    return response.tools || [];
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      running: !!this.process,
      projectRoot: this.projectRoot,
    };
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private async sendRequest(method: string, params?: any): Promise<any> {
    if (!this.process?.stdin) {
      throw new Error('MCP process stdin not available');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // LSP-style framing with Content-Length header (required by MCP stdio)
      const json = JSON.stringify(request);
      const frame = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`;
      this.process!.stdin!.write(frame);

      // 超时处理（30 秒）
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * 处理 stdout 数据
   */
  private handleStdout(data: Buffer) {
    this.buffer += data.toString('utf8');

    // Parse LSP-style frames: headers (CRLF) + CRLF + body
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break; // need more data

      const headerText = this.buffer.slice(0, headerEnd);
      const headers = headerText.split('\r\n');
      let contentLength = 0;
      for (const h of headers) {
        const m = h.match(/^Content-Length:\s*(\d+)/i);
        if (m) {
          contentLength = parseInt(m[1], 10);
        }
      }
      const totalNeeded = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalNeeded) break; // wait for full body

      const body = this.buffer.slice(headerEnd + 4, totalNeeded);
      this.buffer = this.buffer.slice(totalNeeded);

      try {
        const response: JsonRpcResponse = JSON.parse(body);
        this.handleResponse(response);
      } catch (e) {
        console.error('[McpProcessManager] Failed to parse JSON body:', body);
      }
    }
  }

  /**
   * 处理 JSON-RPC 响应
   */
  private handleResponse(response: JsonRpcResponse) {
    const pending = this.pendingRequests.get(response.id as number);
    if (!pending) {
      console.warn('[McpProcessManager] Unexpected response:', response.id);
      return;
    }

    this.pendingRequests.delete(response.id as number);

    if (response.error) {
      pending.reject(response.error);
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * 初始化 MCP 连接
   */
  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'webgal-agent-terre',
        version: '0.1.0',
      },
    });
  }

  /**
   * 清理资源
   */
  private cleanup() {
    this.process = null;
    this.projectRoot = null;
    this.buffer = '';
    
    // 拒绝所有待处理的请求
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('MCP process terminated'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 解析 mcp-webgal 可执行文件路径
   */
  private resolveMcpBin(): string {
    // 在开发环境中，使用 tsx 直接运行源码
    // 在生产环境中，使用编译后的 dist/bin.js

    // 尝试查找 monorepo 根目录
    const monorepoRoot = resolve(__dirname, '../../../..');
    const mcpSrc = resolve(monorepoRoot, 'packages/mcp-webgal/src/bin.ts');
    const mcpDist = resolve(monorepoRoot, 'packages/mcp-webgal/dist/bin.js');

    // 优先使用源码（开发环境）
    try {
      const fs = require('fs');
      if (fs.existsSync(mcpSrc)) {
        return mcpSrc;
      }
    } catch (e) {
      // Ignore
    }

    return mcpDist;
  }
}
