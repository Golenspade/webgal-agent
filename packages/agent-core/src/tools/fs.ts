/**
 * 文件系统工具 - 严格按照 CONTRACTS.md 1.x 规范
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import { FsSandbox, ErrorCode } from '@webgal-agent/tool-bridge';
import { SnapshotManager, computeDiff, type IdempotencyConfig } from './diff-snapshot.js';
import type {
  ListFilesRequest,
  ListFilesResponse,
  ReadFileRequest,
  ReadFileResponse,
  WriteToFileRequest,
  WriteToFileResponse,
  ReplaceInFileRequest,
  ReplaceInFileResponse,
  SearchFilesRequest,
  SearchFilesResponse,
  SearchMatch,
  ListSnapshotsRequest,
  ListSnapshotsResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
} from '../types/index.js';

/**
 * 文件系统工具类
 */
export class FileSystemTools {
  private sandbox: FsSandbox;
  private snapshotManager: SnapshotManager;
  private fileHashes: Map<string, string>; // 用于检测并发冲突

  constructor(
    sandbox: FsSandbox,
    projectRoot: string,
    snapshotRetention: number = 20,
    idempotencyConfig?: IdempotencyConfig
  ) {
    this.sandbox = sandbox;
    this.snapshotManager = new SnapshotManager(
      projectRoot,
      snapshotRetention,
      idempotencyConfig
    );
    this.fileHashes = new Map();
  }

  /**
   * 1.1 list_files - 列出文件/目录
   */
  async listFiles(request: ListFilesRequest): Promise<ListFilesResponse> {
    const absolutePath = this.sandbox.validatePath(request.path);

    try {
      // 检查路径是否存在
      const stats = await fs.stat(absolutePath);

      if (!stats.isDirectory()) {
        throw {
          error: {
            code: ErrorCode.E_BAD_ARGS,
            message: `Path is not a directory: ${request.path}`,
            details: { path: request.path },
            hint: 'Provide a directory path',
            recoverable: true,
          },
        };
      }

      let entries: string[];

      if (request.globs && request.globs.length > 0) {
        // 使用 glob 模式
        const patterns = request.globs.map(g => path.join(absolutePath, g));
        const matches = await glob(patterns, {
          cwd: absolutePath,
          dot: false,
          nodir: request.dirsOnly === true ? false : undefined,
        });

        // 转换为相对路径
        entries = matches.map(m => path.relative(absolutePath, m));
      } else {
        // 列出直接子项
        const items = await fs.readdir(absolutePath, { withFileTypes: true });

        entries = items
          .filter(item => {
            if (request.dirsOnly === true) {
              return item.isDirectory();
            }
            return true;
          })
          .map(item => item.name);
      }

      return { entries };
    } catch (err) {
      if ((err as any).error) {
        throw err; // 已经是 ToolError
      }

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `Directory not found: ${request.path}`,
            details: { path: request.path },
            hint: 'Check the directory path',
            recoverable: true,
          },
        };
      }

      throw {
        error: {
          code: ErrorCode.E_IO,
          message: `Failed to list files: ${(err as Error).message}`,
          details: { path: request.path },
          recoverable: false,
        },
      };
    }
  }

  /**
   * 1.2 read_file - 读取文件
   */
  async readFile(request: ReadFileRequest): Promise<ReadFileResponse> {
    const absolutePath = this.sandbox.validatePath(request.path);

    // 检查文件大小（支持 per-call 限制）
    try {
      const stats = await fs.stat(absolutePath);
      const maxBytes = request.maxBytes || this.sandbox.getConfig().maxReadBytes;

      if (stats.size > maxBytes) {
        throw {
          error: {
            code: ErrorCode.E_TOO_LARGE,
            message: `File too large: ${stats.size} bytes (max: ${maxBytes})`,
            details: {
              path: request.path,
              size: stats.size,
              maxBytes
            },
            hint: 'Increase maxBytes or read file in chunks',
            recoverable: true,
          },
        };
      }
    } catch (err) {
      if ((err as any).error) {
        throw err;
      }

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `File not found: ${request.path}`,
            details: { path: request.path },
            hint: 'Check the file path',
            recoverable: true,
          },
        };
      }

      throw {
        error: {
          code: ErrorCode.E_IO,
          message: `Failed to stat file: ${(err as Error).message}`,
          details: { path: request.path },
          recoverable: false,
        },
      };
    }

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');

      return {
        path: request.path,
        content,
        encoding: 'utf-8',
        bytes: Buffer.byteLength(content, 'utf-8'),
      };
    } catch (err) {
      if ((err as any).error) {
        throw err;
      }

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `File not found: ${request.path}`,
            details: { path: request.path },
            hint: 'Check the file path',
            recoverable: true,
          },
        };
      }

      throw {
        error: {
          code: ErrorCode.E_ENCODING,
          message: `Failed to read file as UTF-8: ${(err as Error).message}`,
          details: { path: request.path },
          hint: 'Ensure the file is a valid UTF-8 text file',
          recoverable: false,
        },
      };
    }
  }

  /**
   * 1.3 write_to_file - 写入文件（支持 dry-run、diff、快照、幂等）
   */
  async writeToFile(request: WriteToFileRequest): Promise<WriteToFileResponse> {
    const absolutePath = this.sandbox.validatePath(request.path);
    const mode = request.mode || 'overwrite';

    try {
      // 读取现有内容（如果存在）
      let oldContent = '';
      let fileExists = false;

      try {
        oldContent = await fs.readFile(absolutePath, 'utf-8');
        fileExists = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }

      // 计算新内容
      let newContent: string;
      if (mode === 'append') {
        newContent = oldContent + request.content;
      } else {
        newContent = request.content;
      }

      // Dry-run 模式：只返回 diff
      if (request.dryRun) {
        const diff = computeDiff(oldContent, newContent);

        // 记录当前文件哈希（用于后续冲突检测）
        if (fileExists) {
          const currentHash = this.snapshotManager.computeHash(oldContent);
          this.fileHashes.set(request.path, currentHash);
        }

        return {
          applied: false,
          diff,
        };
      }

      // 实际写入模式：先检查幂等性
      if (request.idempotencyKey) {
        // 确保 SnapshotManager 已初始化（加载幂等缓存）
        await this.snapshotManager.initialize();
        const cachedSnapshotId = this.snapshotManager.getIdempotencyCache(request.idempotencyKey);
        if (cachedSnapshotId) {
          // 幂等键命中：直接返回缓存的 snapshotId，不写入文件
          return {
            applied: true,
            snapshotId: cachedSnapshotId,
            bytesWritten: 0, // 未实际写入
          };
        }
      }

      // 检查冲突
      if (fileExists && this.fileHashes.has(request.path)) {
        const expectedHash = this.fileHashes.get(request.path)!;
        const currentHash = this.snapshotManager.computeHash(oldContent);

        if (expectedHash !== currentHash) {
          throw {
            error: {
              code: ErrorCode.E_CONFLICT,
              message: 'File has been modified since dry-run',
              details: {
                path: request.path,
                expectedHash,
                currentHash,
              },
              hint: 'Resolve conflict: 1) read_file to fetch latest content; 2) run write_to_file with dryRun=true to regenerate diff; 3) review changes; 4) apply when correct',
              recoverable: true,
            },
          };
        }
      }

      // 原子写入：先写临时文件，再重命名
      const tempPath = `${absolutePath}.tmp`;
      await fs.writeFile(tempPath, newContent, 'utf-8');
      await fs.rename(tempPath, absolutePath);

      // 保存快照
      const snapshotId = await this.snapshotManager.saveSnapshot(
        request.path,
        newContent,
        request.idempotencyKey
      );

      // 清除哈希缓存
      this.fileHashes.delete(request.path);

      return {
        applied: true,
        snapshotId,
        bytesWritten: Buffer.byteLength(newContent, 'utf-8'),
      };
    } catch (err) {
      if ((err as any).error) {
        throw err;
      }

      throw {
        error: {
          code: ErrorCode.E_IO,
          message: `Failed to write file: ${(err as Error).message}`,
          details: { path: request.path },
          recoverable: false,
        },
      };
    }
  }

  /**
   * 1.4 replace_in_file - 文件内替换
   */
  async replaceInFile(request: ReplaceInFileRequest): Promise<ReplaceInFileResponse> {
    const absolutePath = this.sandbox.validatePath(request.path);

    try {
      // 读取文件
      const content = await fs.readFile(absolutePath, 'utf-8');
      const baseHash = this.snapshotManager.computeHash(content);

      // 构建正则表达式
      let regex: RegExp;
      try {
        regex = new RegExp(request.find, request.flags || 'g');
      } catch (err) {
        throw {
          error: {
            code: ErrorCode.E_BAD_ARGS,
            message: `Invalid regex pattern: ${(err as Error).message}`,
            details: { find: request.find, flags: request.flags },
            hint: 'Check your regex syntax',
            recoverable: true,
          },
        };
      }

      // 执行替换并计数
      let count = 0;
      const newContent = content.replace(regex, (match) => {
        count++;
        return request.replace;
      });

      // 写回文件（并发安全：在写之前确认内容未改变）
      if (count > 0) {
        // 再次读取当前内容，检测是否发生并发修改
        const current = await fs.readFile(absolutePath, 'utf-8').catch(() => content);
        const currentHash = this.snapshotManager.computeHash(current);
        if (currentHash !== baseHash) {
          throw {
            error: {
              code: ErrorCode.E_CONFLICT,
              message: 'File has been modified since replacement was prepared',
              details: {
                path: request.path,
                expectedHash: baseHash,
                currentHash,
              },
              hint: 'Resolve conflict: 1) read_file to fetch latest content; 2) adjust find/replace; 3) retry replace_in_file or use write_to_file dry-run flow',
              recoverable: true,
            },
          };
        }

        // 原子写入：先写临时文件再重命名
        const tempPath = `${absolutePath}.tmp`;
        await fs.writeFile(tempPath, newContent, 'utf-8');
        await fs.rename(tempPath, absolutePath);
      }

      return { count };
    } catch (err) {
      if ((err as any).error) {
        throw err;
      }

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `File not found: ${request.path}`,
            details: { path: request.path },
            recoverable: true,
          },
        };
      }

      throw {
        error: {
          code: ErrorCode.E_IO,
          message: `Failed to replace in file: ${(err as Error).message}`,
          details: { path: request.path },
          recoverable: false,
        },
      };
    }
  }

  /**
   * 1.5 search_files - 搜索文件
   */
  async searchFiles(request: SearchFilesRequest): Promise<SearchFilesResponse> {
    const absolutePath = this.sandbox.validatePath(request.path);
    const maxMatches = request.maxMatches || 2000;

    try {
      // 构建正则表达式
      let regex: RegExp;
      try {
        regex = new RegExp(request.regex, 'gm');
      } catch (err) {
        throw {
          error: {
            code: ErrorCode.E_BAD_ARGS,
            message: `Invalid regex pattern: ${(err as Error).message}`,
            details: { regex: request.regex },
            hint: 'Check your regex syntax',
            recoverable: true,
          },
        };
      }

      // 获取要搜索的文件列表
      const pattern = request.filePattern || '**/*';
      const files = await glob(pattern, {
        cwd: absolutePath,
        nodir: true,
        dot: false,
        absolute: true,
      });

      const matches: SearchMatch[] = [];

      // 搜索每个文件
      for (const file of files) {
        if (matches.length >= maxMatches) {
          break;
        }

        try {
          const content = await fs.readFile(file, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxMatches) {
              break;
            }

            const line = lines[i];
            if (regex.test(line)) {
              matches.push({
                path: path.relative(absolutePath, file),
                line: i + 1,
                preview: line.trim().substring(0, 200), // 限制预览长度
              });
            }

            // 重置 regex lastIndex
            regex.lastIndex = 0;
          }
        } catch (err) {
          // 跳过无法读取的文件
          continue;
        }
      }

      return { matches };
    } catch (err) {
      if ((err as any).error) {
        throw err;
      }

      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `Directory not found: ${request.path}`,
            details: { path: request.path },
            recoverable: true,
          },
        };
      }

      throw {
        error: {
          code: ErrorCode.E_IO,
          message: `Failed to search files: ${(err as Error).message}`,
          details: { path: request.path },
          recoverable: false,
        },
      };
    }
  }

  /**
   * 列出快照
   */
  async listSnapshots(request: ListSnapshotsRequest): Promise<ListSnapshotsResponse> {
    // 参数验证
    if (request.limit !== undefined) {
      if (typeof request.limit !== 'number') {
        throw {
          error: {
            code: ErrorCode.E_BAD_ARGS,
            message: 'limit must be a number',
            details: { limit: request.limit },
            hint: 'Provide a positive integer for limit',
            recoverable: true,
          },
        };
      }
    }

    if (request.path !== undefined) {
      if (typeof request.path !== 'string') {
        throw {
          error: {
            code: ErrorCode.E_BAD_ARGS,
            message: 'path must be a string',
            details: { path: request.path },
            hint: 'Provide a valid path string for filtering',
            recoverable: true,
          },
        };
      }
    }

    try {
      const snapshots = await this.snapshotManager.listSnapshots({
        limit: request.limit,
        path: request.path,
      });

      return { snapshots };
    } catch (err) {
      throw {
        error: {
          code: ErrorCode.E_INTERNAL,
          message: `Failed to list snapshots: ${(err as Error).message}`,
          recoverable: false,
        },
      };
    }
  }

  /**
   * 恢复快照
   */
  async restoreSnapshot(request: RestoreSnapshotRequest): Promise<RestoreSnapshotResponse> {
    // 参数验证
    if (!request.snapshotId || typeof request.snapshotId !== 'string') {
      throw {
        error: {
          code: ErrorCode.E_BAD_ARGS,
          message: 'snapshotId is required and must be a string',
          details: { snapshotId: request.snapshotId },
          hint: 'Provide a valid snapshot ID (e.g., snap_20231201T120000_abcd1234)',
          recoverable: true,
        },
      };
    }

    // 验证 snapshotId 格式
    if (!/^snap_\d{8}T\d{6}_[0-9a-f]{8}$/.test(request.snapshotId)) {
      throw {
        error: {
          code: ErrorCode.E_BAD_ARGS,
          message: `Invalid snapshot ID format: ${request.snapshotId}`,
          details: { snapshotId: request.snapshotId },
          hint: 'Snapshot ID must match format: snap_YYYYMMDDThhmmss_<8hex>',
          recoverable: true,
        },
      };
    }

    try {
      const result = await this.snapshotManager.restoreSnapshot(request.snapshotId);
      return result;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `Snapshot not found: ${request.snapshotId}`,
            details: { snapshotId: request.snapshotId },
            hint: 'The snapshot may have been cleaned up or never existed',
            recoverable: true,
          },
        };
      }

      // JSON 解析错误
      if (err instanceof SyntaxError) {
        throw {
          error: {
            code: ErrorCode.E_PARSE_FAIL,
            message: `Snapshot metadata is corrupted: ${request.snapshotId}`,
            details: { snapshotId: request.snapshotId },
            hint: 'The snapshot metadata file may be damaged',
            recoverable: false,
          },
        };
      }

      throw {
        error: {
          code: ErrorCode.E_INTERNAL,
          message: `Failed to restore snapshot: ${(err as Error).message}`,
          details: { snapshotId: request.snapshotId },
          recoverable: false,
        },
      };
    }
  }
}
