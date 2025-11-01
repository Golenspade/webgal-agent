/**
 * Diff 与快照测试
 */

import { computeDiff, SnapshotManager } from '@webgal-agent/agent-core/tools/diff-snapshot';
import {
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  TestRunner,
} from './test-utils.js';

const runner = new TestRunner();

// computeDiff 测试
runner.test('computeDiff: should handle new content', async () => {
  const oldContent = '';
  const newContent = 'line1\nline2\nline3';

  const diff = computeDiff(oldContent, newContent);

  assert(diff.hunks.length > 0, 'should have hunks');
  assert(diff.hunks[0].linesNew.length === 3, 'should have 3 new lines');
  // 空字符串 split('\n') 返回 ['']，所以 linesOld 会有 1 个空字符串
  assert(diff.hunks[0].linesOld.length <= 1, 'should have 0 or 1 old lines (empty string)');
});

runner.test('computeDiff: should handle deleted content', async () => {
  const oldContent = 'line1\nline2\nline3';
  const newContent = '';

  const diff = computeDiff(oldContent, newContent);

  assert(diff.hunks.length > 0, 'should have hunks');
  assert(diff.hunks[0].linesOld.length === 3, 'should have 3 old lines');
  // 空字符串 split('\n') 返回 ['']，所以 linesNew 会有 1 个空字符串
  assert(diff.hunks[0].linesNew.length <= 1, 'should have 0 or 1 new lines (empty string)');
});

runner.test('computeDiff: should handle modified content', async () => {
  const oldContent = 'line1\nline2\nline3';
  const newContent = 'line1\nmodified\nline3';
  
  const diff = computeDiff(oldContent, newContent);
  
  assert(diff.hunks.length > 0, 'should have hunks');
  assert(diff.hunks.some(h => h.linesOld.includes('line2')), 'should include old line');
  assert(diff.hunks.some(h => h.linesNew.includes('modified')), 'should include new line');
});

runner.test('computeDiff: should group consecutive changes', async () => {
  const oldContent = 'line1\nline2\nline3\nline4';
  const newContent = 'line1\nmodified2\nmodified3\nline4';
  
  const diff = computeDiff(oldContent, newContent);
  
  // 连续的修改应该合并到一个 hunk
  assert(diff.hunks.length === 1, 'should have 1 hunk for consecutive changes');
});

// SnapshotManager 测试
runner.test('SnapshotManager: should create snapshot with correct format', async () => {
  const projectRoot = await createTestProject();

  try {
    const manager = new SnapshotManager(projectRoot, 20);

    const snapshotId = await manager.saveSnapshot('test.txt', 'content', 'key1');

    // 格式: snap_YYYYMMDDThhmmss_<8hex>
    assert(/^snap_\d{8}T\d{6}_[0-9a-f]{8}$/.test(snapshotId), 'should match snapshot ID format');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('SnapshotManager: should enforce retention policy', async () => {
  const projectRoot = await createTestProject();

  try {
    const manager = new SnapshotManager(projectRoot, 2); // 只保留 2 个

    // 创建 3 个快照
    await manager.saveSnapshot('test.txt', 'content1', 'key1');
    await manager.saveSnapshot('test.txt', 'content2', 'key2');
    await manager.saveSnapshot('test.txt', 'content3', 'key3');
    
    // 检查快照目录
    const fs = await import('fs/promises');
    const path = await import('path');
    const snapshotDir = path.join(projectRoot, '.webgal_agent/snapshots');
    const files = await fs.readdir(snapshotDir);
    
    // 应该只有 2 个快照（每个快照有 .txt 和 .meta.json）
    const snapshots = files.filter(f => f.endsWith('.txt'));
    assertEqual(snapshots.length, 2, 'should only keep 2 snapshots');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('SnapshotManager: should cache idempotency keys', async () => {
  const projectRoot = await createTestProject();

  try {
    const manager = new SnapshotManager(projectRoot, 20);

    const id1 = await manager.saveSnapshot('test.txt', 'content', 'same-key');
    const id2 = await manager.saveSnapshot('test.txt', 'content', 'same-key');

    assertEqual(id1, id2, 'should return same snapshot ID for same idempotency key');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('SnapshotManager: should restore snapshot', async () => {
  const projectRoot = await createTestProject();

  try {
    const manager = new SnapshotManager(projectRoot, 20);

    const originalContent = 'original content';
    const snapshotId = await manager.saveSnapshot('test.txt', originalContent, 'key1');

    const restored = await manager.restoreSnapshot(snapshotId);

    assertEqual(restored.path, 'test.txt', 'should restore correct path');
    assertEqual(restored.content, originalContent, 'should restore correct content');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('SnapshotManager: should store metadata', async () => {
  const projectRoot = await createTestProject();

  try {
    const manager = new SnapshotManager(projectRoot, 20);

    const snapshotId = await manager.saveSnapshot('test.txt', 'content', 'key1');

    // 读取元数据
    const fs = await import('fs/promises');
    const path = await import('path');
    const metaPath = path.join(projectRoot, '.webgal_agent/snapshots', `${snapshotId}.meta.json`);
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    assertEqual(meta.id, snapshotId);
    assertEqual(meta.path, 'test.txt');
    assertEqual(meta.idempotencyKey, 'key1');
    assert(meta.timestamp, 'should have timestamp');
    assert(meta.contentHash, 'should have contentHash');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

export { runner };

