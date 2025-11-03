/**
 * Diff 计算与快照管理
 * 严格按照 CONTRACTS.md 0.4 规范
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Diff, DiffHunk } from '../types/index.js';

/**
 * 快照元数据
 */
export interface SnapshotMetadata {
  id: string;
  path: string;
  timestamp: number;
  contentHash: string;
  idempotencyKey?: string;
}

/**
 * 幂等缓存条目
 */
export interface IdempotencyEntry {
  snapshotId: string;
  timestamp: number;
}

/**
 * 幂等缓存配置
 */
export interface IdempotencyConfig {
  maxEntries: number;
  maxAgeDays: number;
}

/**
 * 快照管理器
 */
export class SnapshotManager {
  private snapshotDir: string;
  private retention: number;
  private idempotencyCache: Map<string, string>; // key -> snapshotId (内存缓存)
  private idempotencyFile: string; // 持久化文件路径
  private idempotencyConfig: IdempotencyConfig;

  constructor(
    projectRoot: string,
    retention: number = 20,
    idempotencyConfig: IdempotencyConfig = { maxEntries: 500, maxAgeDays: 7 }
  ) {
    this.snapshotDir = path.join(projectRoot, '.webgal_agent', 'snapshots');
    this.retention = retention;
    this.idempotencyCache = new Map();
    this.idempotencyFile = path.join(projectRoot, '.webgal_agent', 'idem.json');
    this.idempotencyConfig = idempotencyConfig;
  }

  /**
   * 初始化快照目录和幂等缓存
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.snapshotDir, { recursive: true });
    await this.loadIdempotencyCache();
  }

  /**
   * 加载幂等缓存（从磁盘）
   */
  private async loadIdempotencyCache(): Promise<void> {
    try {
      const content = await fs.readFile(this.idempotencyFile, 'utf-8');
      const data: Record<string, IdempotencyEntry> = JSON.parse(content);

      // 加载到内存缓存
      for (const [key, entry] of Object.entries(data)) {
        this.idempotencyCache.set(key, entry.snapshotId);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('警告: 加载幂等缓存失败:', error.message);
      }
      // 文件不存在或解析失败，使用空缓存
    }
  }

  /**
   * 保存幂等缓存条目（到磁盘）
   */
  private async saveIdempotencyEntry(key: string, snapshotId: string): Promise<void> {
    try {
      // 读取现有数据
      let data: Record<string, IdempotencyEntry> = {};
      try {
        const content = await fs.readFile(this.idempotencyFile, 'utf-8');
        data = JSON.parse(content);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      // 添加新条目
      data[key] = {
        snapshotId,
        timestamp: Date.now(),
      };

      // 清理过期条目
      await this.cleanupIdempotencyCache(data);

      // 写回磁盘
      await fs.writeFile(this.idempotencyFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error: any) {
      console.error('警告: 保存幂等缓存失败:', error.message);
    }
  }

  /**
   * 清理幂等缓存（LRU 策略）
   */
  private async cleanupIdempotencyCache(data: Record<string, IdempotencyEntry>): Promise<void> {
    const now = Date.now();
    const maxAge = this.idempotencyConfig.maxAgeDays * 24 * 60 * 60 * 1000;

    // 1. 删除过期条目（超过 maxAgeDays）
    const entries = Object.entries(data);
    const validEntries = entries.filter(([_, entry]) => {
      return now - entry.timestamp < maxAge;
    });

    // 2. 如果仍然超过 maxEntries，按时间戳排序并保留最新的
    if (validEntries.length > this.idempotencyConfig.maxEntries) {
      validEntries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      validEntries.splice(this.idempotencyConfig.maxEntries);
    }

    // 3. 重建 data 对象
    const newData: Record<string, IdempotencyEntry> = {};
    for (const [key, entry] of validEntries) {
      newData[key] = entry;
    }

    // 4. 更新传入的 data 对象（引用传递）
    for (const key of Object.keys(data)) {
      delete data[key];
    }
    Object.assign(data, newData);
  }

  /**
   * 生成快照 ID
   */
  generateSnapshotId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0];
    const random = crypto.randomBytes(4).toString('hex');
    return `snap_${timestamp}_${random}`;
  }

  /**
   * 计算内容哈希
   */
  computeHash(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /**
   * 保存快照
   */
  async saveSnapshot(
    filePath: string,
    content: string,
    idempotencyKey?: string
  ): Promise<string> {
    await this.initialize();

    // 检查幂等性
    if (idempotencyKey && this.idempotencyCache.has(idempotencyKey)) {
      return this.idempotencyCache.get(idempotencyKey)!;
    }

    const snapshotId = this.generateSnapshotId();
    const contentHash = this.computeHash(content);

    const metadata: SnapshotMetadata = {
      id: snapshotId,
      path: filePath,
      timestamp: Date.now(),
      contentHash,
      idempotencyKey,
    };

    // 保存内容
    const contentPath = path.join(this.snapshotDir, `${snapshotId}.txt`);
    await fs.writeFile(contentPath, content, 'utf-8');

    // 保存元数据
    const metaPath = path.join(this.snapshotDir, `${snapshotId}.meta.json`);
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    // 缓存幂等性键（内存 + 磁盘）
    if (idempotencyKey) {
      this.idempotencyCache.set(idempotencyKey, snapshotId);
      await this.saveIdempotencyEntry(idempotencyKey, snapshotId);
    }

    // 清理旧快照
    await this.cleanupOldSnapshots();

    return snapshotId;
  }

  /**
   * 清理旧快照（保留最近 N 个）
   */
  private async cleanupOldSnapshots(): Promise<void> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      const metaFiles = files.filter(f => f.endsWith('.meta.json'));

      if (metaFiles.length <= this.retention) {
        return;
      }

      // 读取所有元数据并按时间排序
      const snapshots: SnapshotMetadata[] = [];
      for (const metaFile of metaFiles) {
        const metaPath = path.join(this.snapshotDir, metaFile);
        const content = await fs.readFile(metaPath, 'utf-8');
        snapshots.push(JSON.parse(content));
      }

      snapshots.sort((a, b) => b.timestamp - a.timestamp);

      // 删除超出保留数量的快照
      const toDelete = snapshots.slice(this.retention);
      for (const snapshot of toDelete) {
        const contentPath = path.join(this.snapshotDir, `${snapshot.id}.txt`);
        const metaPath = path.join(this.snapshotDir, `${snapshot.id}.meta.json`);
        
        await fs.unlink(contentPath).catch(() => {});
        await fs.unlink(metaPath).catch(() => {});
      }
    } catch (err) {
      console.warn('Failed to cleanup old snapshots:', err);
    }
  }

  /**
   * 列出快照
   * @param options.limit - 最大返回数量（默认 50，负数/NaN 会被规范化）
   * @param options.path - 按路径过滤（POSIX 格式前缀匹配，如 'game/scene'）
   */
  async listSnapshots(options?: {
    limit?: number;
    path?: string;
  }): Promise<SnapshotMetadata[]> {
    // 规范化 limit：处理负数、NaN、undefined
    let limit = options?.limit ?? 50;
    if (typeof limit !== 'number' || isNaN(limit) || limit < 0) {
      limit = 50;
    }
    limit = Math.min(limit, 1000); // 最大 1000 条

    // 规范化 path：转换为 POSIX 格式
    const filterPath = options?.path ? path.posix.normalize(options.path) : undefined;

    try {
      await this.initialize();
      const files = await fs.readdir(this.snapshotDir);
      const metaFiles = files.filter(f => f.endsWith('.meta.json'));

      // 读取所有元数据
      const snapshots: SnapshotMetadata[] = [];
      for (const metaFile of metaFiles) {
        try {
          const metaPath = path.join(this.snapshotDir, metaFile);
          const contentPath = path.join(this.snapshotDir, metaFile.replace('.meta.json', '.txt'));

          // 检查对应的 .txt 文件是否存在
          try {
            await fs.access(contentPath);
          } catch {
            // 跳过缺少内容文件的快照
            console.warn(`Skipping snapshot with missing content: ${metaFile}`);
            continue;
          }

          const content = await fs.readFile(metaPath, 'utf-8');
          const metadata: SnapshotMetadata = JSON.parse(content);

          // 规范化存储的路径为 POSIX 格式
          const normalizedPath = path.posix.normalize(metadata.path);

          // 路径过滤（前缀匹配）
          if (filterPath && !normalizedPath.startsWith(filterPath)) {
            continue;
          }

          snapshots.push(metadata);
        } catch (err) {
          // 跳过损坏的元数据文件（JSON 解析失败等）
          console.warn(`Failed to read snapshot metadata: ${metaFile}`, err);
        }
      }

      // 按时间降序排序，timestamp 相同时按 id 排序（稳定性）
      snapshots.sort((a, b) => {
        const timeDiff = b.timestamp - a.timestamp;
        if (timeDiff !== 0) return timeDiff;
        return b.id.localeCompare(a.id);
      });

      // 限制返回数量（在过滤后应用）
      return snapshots.slice(0, limit);
    } catch (err) {
      // 目录不存在或读取失败，返回空数组
      return [];
    }
  }

  /**
   * 恢复快照
   */
  /**
   * 恢复快照
   * @param snapshotId - 快照 ID
   * @throws ENOENT 如果快照不存在
   * @throws Error 如果 JSON 解析失败
   */
  async restoreSnapshot(snapshotId: string): Promise<{ path: string; content: string }> {
    const contentPath = path.join(this.snapshotDir, `${snapshotId}.txt`);
    const metaPath = path.join(this.snapshotDir, `${snapshotId}.meta.json`);

    // 读取内容和元数据（会抛出 ENOENT）
    const content = await fs.readFile(contentPath, 'utf-8');
    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const metadata: SnapshotMetadata = JSON.parse(metaContent);

    return {
      path: metadata.path,
      content,
    };
  }
}

/**
 * 计算两个文本之间的 Diff
 * 使用简单的逐行比较算法
 */
export function computeDiff(oldContent: string, newContent: string): Diff {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const hunks: DiffHunk[] = [];

  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // 找到第一个不同的行
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
    }

    if (i >= oldLines.length && j >= newLines.length) {
      break;
    }

    // 找到差异块的结束位置
    const startOld = i + 1;
    const startNew = j + 1;
    const linesOld: string[] = [];
    const linesNew: string[] = [];

    // 简单策略：收集连续的不同行，直到找到相同的行或到达末尾
    let foundMatch = false;
    const lookAhead = 3; // 向前查找相同行的窗口

    while (!foundMatch && (i < oldLines.length || j < newLines.length)) {
      if (i < oldLines.length) {
        linesOld.push(oldLines[i]);
        i++;
      }
      if (j < newLines.length) {
        linesNew.push(newLines[j]);
        j++;
      }

      // 检查是否找到匹配
      if (i < oldLines.length && j < newLines.length) {
        let matchCount = 0;
        for (let k = 0; k < lookAhead && i + k < oldLines.length && j + k < newLines.length; k++) {
          if (oldLines[i + k] === newLines[j + k]) {
            matchCount++;
          }
        }
        if (matchCount >= 2) {
          foundMatch = true;
        }
      }

      // 防止块过大
      if (linesOld.length > 100 || linesNew.length > 100) {
        break;
      }
    }

    hunks.push({
      startOld,
      lenOld: linesOld.length,
      startNew,
      lenNew: linesNew.length,
      linesOld,
      linesNew,
    });
  }

  return {
    type: 'line',
    hunks,
  };
}

/**
 * 应用 Diff 到内容
 */
export function applyDiff(oldContent: string, diff: Diff): string {
  const oldLines = oldContent.split('\n');
  const newLines: string[] = [];

  let oldIndex = 0;

  for (const hunk of diff.hunks) {
    // 复制未改变的行
    while (oldIndex < hunk.startOld - 1) {
      newLines.push(oldLines[oldIndex]);
      oldIndex++;
    }

    // 跳过旧行，添加新行
    oldIndex += hunk.lenOld;
    newLines.push(...hunk.linesNew);
  }

  // 复制剩余的行
  while (oldIndex < oldLines.length) {
    newLines.push(oldLines[oldIndex]);
    oldIndex++;
  }

  return newLines.join('\n');
}

