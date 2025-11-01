/**
 * WebGAL 预览与资源工具
 * 严格按照 CONTRACTS.md 2.1 和 2.3 规范
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { FsSandbox, ErrorCode, CommandExecutor } from '@webgal-agent/tool-bridge';
import type {
  ListProjectResourcesResponse,
  PreviewSceneRequest,
  PreviewSceneResponse,
} from '../types/index.js';

/**
 * WebGAL 资源与预览工具类
 */
export class WebGALTools {
  private sandbox: FsSandbox;
  private projectRoot: string;
  private executor?: CommandExecutor;

  constructor(sandbox: FsSandbox, projectRoot: string, executor?: CommandExecutor) {
    this.sandbox = sandbox;
    this.projectRoot = projectRoot;
    this.executor = executor;
  }

  /**
   * 2.1 list_project_resources - 列出项目资源
   */
  async listProjectResources(): Promise<ListProjectResourcesResponse> {
    const result: ListProjectResourcesResponse = {
      backgrounds: [],
      figures: [],
      bgm: [],
      vocals: [],
      scenes: [],
    };

    // 列出背景
    try {
      const bgPath = this.sandbox.validatePath('game/background');
      const bgFiles = await fs.readdir(bgPath);
      result.backgrounds = bgFiles.filter(f => this.isImageFile(f));
    } catch (err) {
      // 目录不存在，保持空数组
    }

    // 列出立绘
    try {
      const figPath = this.sandbox.validatePath('game/figure');
      const figFiles = await fs.readdir(figPath);
      result.figures = figFiles.filter(f => this.isImageFile(f));
    } catch (err) {
      // 目录不存在，保持空数组
    }

    // 列出 BGM
    try {
      const bgmPath = this.sandbox.validatePath('game/bgm');
      const bgmFiles = await fs.readdir(bgmPath);
      result.bgm = bgmFiles.filter(f => this.isAudioFile(f));
    } catch (err) {
      // 目录不存在，保持空数组
    }

    // 列出语音
    try {
      const vocalPath = this.sandbox.validatePath('game/vocal');
      const vocalFiles = await fs.readdir(vocalPath);
      result.vocals = vocalFiles.filter(f => this.isAudioFile(f));
    } catch (err) {
      // 目录不存在，保持空数组
    }

    // 列出场景
    try {
      const scenePath = this.sandbox.validatePath('game/scene');
      const sceneFiles = await fs.readdir(scenePath);
      result.scenes = sceneFiles.filter(f => f.endsWith('.txt'));
    } catch (err) {
      // 目录不存在，保持空数组
    }

    return result;
  }

  /**
   * 2.3 preview_scene - 预览场景
   */
  async previewScene(request: PreviewSceneRequest): Promise<PreviewSceneResponse> {
    // 检查是否有 executor（dev 模式）
    if (!this.executor) {
      throw {
        error: {
          code: ErrorCode.E_TOOL_DISABLED,
          message: 'Preview requires dev mode with command execution enabled',
          hint: 'Enable execution in policies.json or use WebGAL Terre for preview',
          recoverable: false,
        },
      };
    }

    const logs: string[] = [];

    try {
      // 1. 检查场景文件是否存在（如果指定了）
      if (request.scenePath) {
        const scenePath = this.sandbox.validatePath(request.scenePath);
        try {
          await fs.access(scenePath);
        } catch {
          throw {
            error: {
              code: ErrorCode.E_NOT_FOUND,
              message: `Scene file not found: ${request.scenePath}`,
              details: { scenePath: request.scenePath },
              hint: 'Check the scene file path',
              recoverable: true,
            },
          };
        }
      }

      // 2. 尝试启动 dev 服务器（流式执行，匹配到端口后立即返回）
      logs.push('Starting dev server...');

      const result = await this.executor.executeStream('dev', [], {
        earlyReturnPattern: /localhost:(\d+)|127\.0\.0\.1:(\d+)|port\s+(\d+)/i,
        earlyReturnTimeoutMs: 20000, // 20 秒超时
        keepAlive: true, // 保持 dev 服务器运行
      });

      logs.push(...result.logs);

      if (!result.ok) {
        throw {
          error: {
            code: ErrorCode.E_PREVIEW_FAIL,
            message: 'Failed to start dev server',
            details: { logs: result.logs },
            hint: 'Check the dev server logs for errors',
            recoverable: true,
          },
        };
      }

      // 3. 从日志中提取端口
      const port = this.extractPortFromLogs(result.logs);

      if (!port) {
        throw {
          error: {
            code: ErrorCode.E_PREVIEW_FAIL,
            message: 'Could not determine dev server port',
            details: { logs: result.logs },
            hint: 'Check if dev server started correctly',
            recoverable: true,
          },
        };
      }

      // 4. 构建预览 URL
      let url = `http://localhost:${port}`;

      if (request.scenePath) {
        // 提取场景名（不含路径和扩展名）
        const sceneName = path.basename(request.scenePath, '.txt');
        url += `#scene=${sceneName}`;
      }

      return {
        url,
        logs,
      };
    } catch (err) {
      if ((err as any).error) {
        throw err;
      }

      throw {
        error: {
          code: ErrorCode.E_PREVIEW_FAIL,
          message: `Preview failed: ${(err as Error).message}`,
          details: { logs },
          recoverable: false,
        },
      };
    }
  }

  /**
   * 从日志中提取端口号
   */
  private extractPortFromLogs(logs: string[]): number | null {
    for (const log of logs) {
      // 匹配常见的端口输出格式
      const patterns = [
        /localhost:(\d+)/i,
        /127\.0\.0\.1:(\d+)/i,
        /port\s+(\d+)/i,
        /:\s*(\d+)/,
      ];

      for (const pattern of patterns) {
        const match = log.match(pattern);
        if (match) {
          const port = parseInt(match[1], 10);
          if (port > 0 && port < 65536) {
            return port;
          }
        }
      }
    }

    // 默认端口
    return 3001;
  }

  /**
   * 检查是否为图片文件
   */
  private isImageFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
  }

  /**
   * 检查是否为音频文件
   */
  private isAudioFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ['.mp3', '.ogg', '.wav', '.m4a', '.flac'].includes(ext);
  }
}

