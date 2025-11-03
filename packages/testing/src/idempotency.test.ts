/**
 * 幂等持久化测试
 * 验证 idempotency key 在重启后仍然有效
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TestRunner } from './test-utils.js';
import { SnapshotManager } from '@webgal-agent/agent-core/tools';

const runner = new TestRunner('幂等持久化');

// 测试项目根目录
const projectRoot = path.resolve(process.cwd(), '../../apps/dev-sandbox');
const idemFile = path.join(projectRoot, '.webgal_agent', 'idem.json');

runner.test('幂等键在重启后仍然有效', async () => {
  // 清理旧的幂等缓存文件
  try {
    await fs.unlink(idemFile);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 第一次：创建 SnapshotManager 并保存快照
  const manager1 = new SnapshotManager(projectRoot, 20);
  const snapshotId1 = await manager1.saveSnapshot(
    'test.txt',
    'Hello World',
    'test-key-1'
  );

  // 验证幂等缓存文件已创建
  const idemContent1 = await fs.readFile(idemFile, 'utf-8');
  const idemData1 = JSON.parse(idemContent1);
  if (!idemData1['test-key-1']) {
    throw new Error('幂等缓存文件未包含 test-key-1');
  }
  if (idemData1['test-key-1'].snapshotId !== snapshotId1) {
    throw new Error('幂等缓存中的 snapshotId 不匹配');
  }

  // 第二次：创建新的 SnapshotManager（模拟重启）
  const manager2 = new SnapshotManager(projectRoot, 20);
  const snapshotId2 = await manager2.saveSnapshot(
    'test.txt',
    'Different Content',
    'test-key-1' // 使用相同的幂等键
  );

  // 验证返回的是相同的 snapshotId（幂等性）
  if (snapshotId2 !== snapshotId1) {
    throw new Error(`幂等性失败: 期望 ${snapshotId1}, 实际 ${snapshotId2}`);
  }

  // 清理
  await fs.unlink(idemFile);
});

runner.test('LRU 清理策略：超过 maxEntries', async () => {
  // 清理旧的幂等缓存文件
  try {
    await fs.unlink(idemFile);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 创建 SnapshotManager，设置 maxEntries = 3
  const manager = new SnapshotManager(projectRoot, 20, {
    maxEntries: 3,
    maxAgeDays: 7,
  });

  // 保存 5 个快照
  await manager.saveSnapshot('test1.txt', 'Content 1', 'key-1');
  await manager.saveSnapshot('test2.txt', 'Content 2', 'key-2');
  await manager.saveSnapshot('test3.txt', 'Content 3', 'key-3');
  await manager.saveSnapshot('test4.txt', 'Content 4', 'key-4');
  await manager.saveSnapshot('test5.txt', 'Content 5', 'key-5');

  // 读取幂等缓存文件
  const idemContent = await fs.readFile(idemFile, 'utf-8');
  const idemData = JSON.parse(idemContent);
  const keys = Object.keys(idemData);

  // 验证只保留了最新的 3 个
  if (keys.length !== 3) {
    throw new Error(`期望保留 3 个条目，实际保留 ${keys.length} 个`);
  }

  // 验证保留的是最新的 3 个（key-3, key-4, key-5）
  if (!idemData['key-3'] || !idemData['key-4'] || !idemData['key-5']) {
    throw new Error('未保留最新的 3 个条目');
  }
  if (idemData['key-1'] || idemData['key-2']) {
    throw new Error('未删除最旧的 2 个条目');
  }

  // 清理
  await fs.unlink(idemFile);
});

runner.test('LRU 清理策略：超过 maxAgeDays', async () => {
  // 清理旧的幂等缓存文件
  try {
    await fs.unlink(idemFile);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }

  // 手动创建一个包含过期条目的幂等缓存文件
  const now = Date.now();
  const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  const oldIdemData = {
    'old-key': {
      snapshotId: 'snap_old',
      timestamp: eightDaysAgo,
    },
    'recent-key': {
      snapshotId: 'snap_recent',
      timestamp: threeDaysAgo,
    },
  };

  await fs.mkdir(path.dirname(idemFile), { recursive: true });
  await fs.writeFile(idemFile, JSON.stringify(oldIdemData, null, 2), 'utf-8');

  // 创建 SnapshotManager，设置 maxAgeDays = 7
  const manager = new SnapshotManager(projectRoot, 20, {
    maxEntries: 500,
    maxAgeDays: 7,
  });

  // 保存一个新快照（触发清理）
  await manager.saveSnapshot('test.txt', 'New Content', 'new-key');

  // 读取幂等缓存文件
  const idemContent = await fs.readFile(idemFile, 'utf-8');
  const idemData = JSON.parse(idemContent);

  // 验证过期条目已删除
  if (idemData['old-key']) {
    throw new Error('过期条目未被删除');
  }

  // 验证未过期条目仍然存在
  if (!idemData['recent-key']) {
    throw new Error('未过期条目被错误删除');
  }

  // 验证新条目已添加
  if (!idemData['new-key']) {
    throw new Error('新条目未添加');
  }

  // 清理
  await fs.unlink(idemFile);
});

export { runner };

