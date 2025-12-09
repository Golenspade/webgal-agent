/**
 * Diff 与快照测试
 */

import { computeDiff, SnapshotManager } from '@webgal-agent/agent-core/tools/diff-snapshot'
import {
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  TestRunner,
} from './test-utils.js'

const runner = new TestRunner()

// computeDiff 测试
runner.test('computeDiff: should handle new content', async () => {
  const oldContent = ''
  const newContent = 'line1\nline2\nline3'

  const diff = computeDiff(oldContent, newContent)

  assert(diff.hunks.length > 0, 'should have hunks')
  assert(diff.hunks[0].linesNew.length === 3, 'should have 3 new lines')
  // 空字符串 split('\n') 返回 ['']，所以 linesOld 会有 1 个空字符串
  assert(diff.hunks[0].linesOld.length <= 1, 'should have 0 or 1 old lines (empty string)')
})

runner.test('computeDiff: should handle deleted content', async () => {
  const oldContent = 'line1\nline2\nline3'
  const newContent = ''

  const diff = computeDiff(oldContent, newContent)

  assert(diff.hunks.length > 0, 'should have hunks')
  assert(diff.hunks[0].linesOld.length === 3, 'should have 3 old lines')
  // 空字符串 split('\n') 返回 ['']，所以 linesNew 会有 1 个空字符串
  assert(diff.hunks[0].linesNew.length <= 1, 'should have 0 or 1 new lines (empty string)')
})

runner.test('computeDiff: should handle modified content', async () => {
  const oldContent = 'line1\nline2\nline3'
  const newContent = 'line1\nmodified\nline3'

  const diff = computeDiff(oldContent, newContent)

  assert(diff.hunks.length > 0, 'should have hunks')
  assert(
    diff.hunks.some((h) => h.linesOld.includes('line2')),
    'should include old line',
  )
  assert(
    diff.hunks.some((h) => h.linesNew.includes('modified')),
    'should include new line',
  )
})

runner.test('computeDiff: should group consecutive changes', async () => {
  const oldContent = 'line1\nline2\nline3\nline4'
  const newContent = 'line1\nmodified2\nmodified3\nline4'

  const diff = computeDiff(oldContent, newContent)

  // 连续的修改应该合并到一个 hunk
  assert(diff.hunks.length === 1, 'should have 1 hunk for consecutive changes')
})

// SnapshotManager 测试
runner.test('SnapshotManager: should create snapshot with correct format', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    const snapshotId = await manager.saveSnapshot('test.txt', 'content', 'key1')

    // 格式: snap_YYYYMMDDThhmmss_<8hex>
    assert(/^snap_\d{8}T\d{6}_[0-9a-f]{8}$/.test(snapshotId), 'should match snapshot ID format')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should enforce retention policy', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 2) // 只保留 2 个

    // 创建 3 个快照
    await manager.saveSnapshot('test.txt', 'content1', 'key1')
    await manager.saveSnapshot('test.txt', 'content2', 'key2')
    await manager.saveSnapshot('test.txt', 'content3', 'key3')

    // 检查快照目录
    const fs = await import('fs/promises')
    const path = await import('path')
    const snapshotDir = path.join(projectRoot, '.webgal_agent/snapshots')
    const files = await fs.readdir(snapshotDir)

    // 应该只有 2 个快照（每个快照有 .txt 和 .meta.json）
    const snapshots = files.filter((f) => f.endsWith('.txt'))
    assertEqual(snapshots.length, 2, 'should only keep 2 snapshots')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should cache idempotency keys', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    const id1 = await manager.saveSnapshot('test.txt', 'content', 'same-key')
    const id2 = await manager.saveSnapshot('test.txt', 'content', 'same-key')

    assertEqual(id1, id2, 'should return same snapshot ID for same idempotency key')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should restore snapshot', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    const originalContent = 'original content'
    const snapshotId = await manager.saveSnapshot('test.txt', originalContent, 'key1')

    const restored = await manager.restoreSnapshot(snapshotId)

    assertEqual(restored.path, 'test.txt', 'should restore correct path')
    assertEqual(restored.content, originalContent, 'should restore correct content')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should store metadata', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    const snapshotId = await manager.saveSnapshot('test.txt', 'content', 'key1')

    // 读取元数据
    const fs = await import('fs/promises')
    const path = await import('path')
    const metaPath = path.join(projectRoot, '.webgal_agent/snapshots', `${snapshotId}.meta.json`)
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'))

    assertEqual(meta.id, snapshotId)
    assertEqual(meta.path, 'test.txt')
    assertEqual(meta.idempotencyKey, 'key1')
    assert(meta.timestamp, 'should have timestamp')
    assert(meta.contentHash, 'should have contentHash')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should list snapshots in descending order', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    // 创建 3 个快照（有时间间隔）
    const id1 = await manager.saveSnapshot('test1.txt', 'content1', 'key1')
    await new Promise((resolve) => setTimeout(resolve, 10)) // 等待 10ms
    const id2 = await manager.saveSnapshot('test2.txt', 'content2', 'key2')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const id3 = await manager.saveSnapshot('test3.txt', 'content3', 'key3')

    const snapshots = await manager.listSnapshots()

    assertEqual(snapshots.length, 3, 'should have 3 snapshots')
    // 按时间降序：最新的在前
    assertEqual(snapshots[0].id, id3, 'newest snapshot should be first')
    assertEqual(snapshots[1].id, id2, 'middle snapshot should be second')
    assertEqual(snapshots[2].id, id1, 'oldest snapshot should be last')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should respect limit parameter', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    // 创建 5 个快照
    for (let i = 0; i < 5; i++) {
      await manager.saveSnapshot(`test${i}.txt`, `content${i}`, `key${i}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const snapshots = await manager.listSnapshots({ limit: 3 })

    assertEqual(snapshots.length, 3, 'should only return 3 snapshots')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should filter by path', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    // 创建不同路径的快照
    await manager.saveSnapshot('game/scene/start.txt', 'content1', 'key1')
    await manager.saveSnapshot('game/scene/chapter1.txt', 'content2', 'key2')
    await manager.saveSnapshot('game/config.json', 'content3', 'key3')

    const sceneSnapshots = await manager.listSnapshots({ path: 'game/scene' })

    assertEqual(sceneSnapshots.length, 2, 'should only return scene snapshots')
    assert(
      sceneSnapshots.every((s) => s.path.startsWith('game/scene')),
      'all paths should start with game/scene',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should return empty array when no snapshots', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    const snapshots = await manager.listSnapshots()

    assertEqual(snapshots.length, 0, 'should return empty array')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should handle restore of non-existent snapshot', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    let errorThrown = false
    try {
      await manager.restoreSnapshot('snap_20231201T120000_abcd1234')
    } catch (err) {
      errorThrown = true
      assert((err as NodeJS.ErrnoException).code === 'ENOENT', 'should throw ENOENT error')
    }

    assert(errorThrown, 'should throw error for non-existent snapshot')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should skip snapshots with missing content files', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)
    const fs = await import('fs/promises')
    const path = await import('path')

    // 创建一个正常快照
    const id1 = await manager.saveSnapshot('test1.txt', 'content1', 'key1')

    // 手动删除内容文件，只保留 meta
    const snapshotDir = path.join(projectRoot, '.webgal_agent/snapshots')
    const contentPath = path.join(snapshotDir, `${id1}.txt`)
    await fs.unlink(contentPath)

    // 创建另一个正常快照
    const id2 = await manager.saveSnapshot('test2.txt', 'content2', 'key2')

    const snapshots = await manager.listSnapshots()

    // 应该只返回有完整文件的快照
    assertEqual(snapshots.length, 1, 'should skip snapshot with missing content')
    assertEqual(snapshots[0].id, id2, 'should return the valid snapshot')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should handle negative limit gracefully', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)

    // 创建 3 个快照
    await manager.saveSnapshot('test1.txt', 'content1', 'key1')
    await manager.saveSnapshot('test2.txt', 'content2', 'key2')
    await manager.saveSnapshot('test3.txt', 'content3', 'key3')

    // 负数 limit 应该被规范化为默认值 50
    const snapshots = await manager.listSnapshots({ limit: -10 })

    assertEqual(snapshots.length, 3, 'should return all snapshots when limit is negative')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('SnapshotManager: should sort by id when timestamps are equal', async () => {
  const projectRoot = await createTestProject()

  try {
    const manager = new SnapshotManager(projectRoot, 20)
    const fs = await import('fs/promises')
    const path = await import('path')

    // 创建两个快照
    const id1 = await manager.saveSnapshot('test1.txt', 'content1', 'key1')
    const id2 = await manager.saveSnapshot('test2.txt', 'content2', 'key2')

    // 手动修改第二个快照的 timestamp 使其与第一个相同
    const snapshotDir = path.join(projectRoot, '.webgal_agent/snapshots')
    const meta1Path = path.join(snapshotDir, `${id1}.meta.json`)
    const meta2Path = path.join(snapshotDir, `${id2}.meta.json`)

    const meta1 = JSON.parse(await fs.readFile(meta1Path, 'utf-8'))
    const meta2 = JSON.parse(await fs.readFile(meta2Path, 'utf-8'))

    meta2.timestamp = meta1.timestamp // 设置相同的 timestamp
    await fs.writeFile(meta2Path, JSON.stringify(meta2, null, 2))

    const snapshots = await manager.listSnapshots()

    // 当 timestamp 相同时，应该按 id 降序排序
    assertEqual(snapshots.length, 2, 'should have 2 snapshots')
    if (id2 > id1) {
      assertEqual(snapshots[0].id, id2, 'larger id should come first')
      assertEqual(snapshots[1].id, id1, 'smaller id should come second')
    } else {
      assertEqual(snapshots[0].id, id1, 'larger id should come first')
      assertEqual(snapshots[1].id, id2, 'smaller id should come second')
    }
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

export { runner }
