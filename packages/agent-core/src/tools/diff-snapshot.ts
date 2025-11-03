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
 * 快照管理器
 */
export class SnapshotManager {
  private snapshotDir: string;
  private retention: number;
  private idempotencyCache: Map<string, string>; // key -> snapshotId

  constructor(projectRoot: string, retention: number = 20) {
    this.snapshotDir = path.join(projectRoot, '.webgal_agent', 'snapshots');
    this.retention = retention;
    this.idempotencyCache = new Map();
  }

  /**
   * 初始化快照目录
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.snapshotDir, { recursive: true });
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

    // 缓存幂等性键
    if (idempotencyKey) {
      this.idempotencyCache.set(idempotencyKey, snapshotId);
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
   * @param options.limit - 最大返回数量（默认 50）
   * @param options.path - 按路径过滤（startsWith 匹配）
   */
  async listSnapshots(options?: {
    limit?: number;
    path?: string;
  }): Promise<SnapshotMetadata[]> {
    const limit = options?.limit ?? 50;
    const filterPath = options?.path;

    try {
      await this.initialize();
      const files = await fs.readdir(this.snapshotDir);
      const metaFiles = files.filter(f => f.endsWith('.meta.json'));

      // 读取所有元数据
      const snapshots: SnapshotMetadata[] = [];
      for (const metaFile of metaFiles) {
        try {
          const metaPath = path.join(this.snapshotDir, metaFile);
          const content = await fs.readFile(metaPath, 'utf-8');
          const metadata: SnapshotMetadata = JSON.parse(content);

          // 路径过滤
          if (filterPath && !metadata.path.startsWith(filterPath)) {
            continue;
          }

          snapshots.push(metadata);
        } catch (err) {
          // 跳过损坏的元数据文件
          console.warn(`Failed to read snapshot metadata: ${metaFile}`, err);
        }
      }

      // 按时间降序排序
      snapshots.sort((a, b) => b.timestamp - a.timestamp);

      // 限制返回数量
      return snapshots.slice(0, limit);
    } catch (err) {
      // 目录不存在或读取失败，返回空数组
      return [];
    }
  }

  /**
   * 恢复快照
   */
  async restoreSnapshot(snapshotId: string): Promise<{ path: string; content: string }> {
    const contentPath = path.join(this.snapshotDir, `${snapshotId}.txt`);
    const metaPath = path.join(this.snapshotDir, `${snapshotId}.meta.json`);

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

