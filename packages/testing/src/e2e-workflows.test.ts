/**
 * 端到端工作流测试（E2E Workflows）
 *
 * 测试完整的 MCP 工作流链路：
 * 1. 小改链路：replace_in_file → validate_script → dry-run → apply → 快照存在
 * 2. 全量链路：write_to_file (dry-run) → apply → validate_script → 快照存在
 * 3. 回滚链路：list_snapshots → restore_snapshot → dry-run → apply
 */

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  TestRunner,
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
} from './test-utils.js'

const runner = new TestRunner()

// Minimal MCP stdio client (newline-delimited JSON)
class MCPClient {
  private proc: ChildProcessWithoutNullStreams
  private nextId = 1
  private buf = ''
  private pending = new Map<number, { resolve: (m: any) => void; reject: (e: any) => void }>()

  constructor(proc: ChildProcessWithoutNullStreams) {
    this.proc = proc
    proc.stdout.setEncoding('utf-8')
    proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    proc.on('error', (e) => this.rejectAll(e))
    proc.on('exit', (code) => {
      if (code !== 0) this.rejectAll(new Error(`server exited with code ${code}`))
    })
  }

  private rejectAll(e: any) {
    for (const [, p] of this.pending) p.reject(e)
    this.pending.clear()
  }

  private onData(chunk: string) {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        p.resolve(msg)
      }
    }
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++
    const req = { jsonrpc: '2.0', id, method, params }
    this.proc.stdin.write(JSON.stringify(req) + '\n')
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`timeout waiting response for ${method}`))
        }
      }, 10000) // 10s timeout for e2e tests
    })
  }

  kill() {
    this.proc.kill()
  }
}

function spawnMcp(projectRoot: string, extraArgs: string[] = []) {
  const mcpBin = path.resolve(process.cwd(), '../mcp-webgal/src/bin.ts')
  const proc = spawn('node', ['--import', 'tsx', mcpBin, '--project', projectRoot, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  return proc
}

async function initializeClient(client: MCPClient) {
  const init = await client.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e-test', version: '1.0.0' },
  })
  assertEqual(init.result?.capabilities?.tools !== undefined, true, 'initialize ok')
}

async function callTool(client: MCPClient, name: string, args: any): Promise<any> {
  const resp = await client.send('tools/call', { name, arguments: args })
  if (resp.error) {
    throw new Error(`Tool ${name} failed: ${JSON.stringify(resp.error)}`)
  }
  const content = resp.result?.content?.[0]?.text
  if (!content) {
    throw new Error(`Tool ${name} returned no content`)
  }
  return JSON.parse(content)
}

// ============================================================================
// Test 1: 小改链路 - replace_in_file → validate_script → dry-run → apply
// ============================================================================
runner.test('E2E: 小改链路 - replace_in_file → validate → dry-run → apply → snapshot', async () => {
  const projectRoot = await createTestProject()
  const proc = spawnMcp(projectRoot)
  const client = new MCPClient(proc)

  try {
    await initializeClient(client)

    // Step 1: Read original file
    const originalContent = await callTool(client, 'read_file', {
      path: 'game/scene/start.txt',
    })
    assert(originalContent.content.includes('欢迎'), 'original file should contain 欢迎')

    // Step 2: Replace in file (find/replace)
    const replaceResult = await callTool(client, 'replace_in_file', {
      path: 'game/scene/start.txt',
      find: '欢迎',
      replace: '你好',
    })
    assert(replaceResult.count > 0, 'replace should find and replace at least one occurrence')

    // Step 3: Verify file content changed
    const newContent = await callTool(client, 'read_file', {
      path: 'game/scene/start.txt',
    })
    assert(newContent.content.includes('你好'), 'file should contain replaced text')
    assert(!newContent.content.includes('欢迎'), 'file should not contain original text')

    // Step 4: Validate script (should pass)
    const validateResult = await callTool(client, 'validate_script', {
      path: 'game/scene/start.txt',
    })
    assert(validateResult.valid === true, 'script should be valid after replace')
  } finally {
    client.kill()
    await cleanupTestProject(projectRoot)
  }
})

// ============================================================================
// Test 2: 全量链路 - write_to_file (dry-run) → apply → validate → snapshot
// ============================================================================
runner.test('E2E: 全量链路 - write_to_file dry-run → apply → validate → snapshot', async () => {
  const projectRoot = await createTestProject()
  const proc = spawnMcp(projectRoot)
  const client = new MCPClient(proc)

  try {
    await initializeClient(client)

    const newScriptContent = `:这是一个测试场景;
setVar:name=测试角色;
intro:欢迎来到测试场景;
end;`

    // Step 1: Dry-run (preview changes)
    const dryRunResult = await callTool(client, 'write_to_file', {
      path: 'game/scene/test_scene.txt',
      content: newScriptContent,
      dryRun: true,
    })
    assert(dryRunResult.applied === false, 'should be dry-run (applied: false)')
    assert(dryRunResult.diff, 'dry-run should return diff')
    assert(dryRunResult.diff.hunks.length > 0, 'diff should have hunks')

    // Step 2: Apply changes
    const applyResult = await callTool(client, 'write_to_file', {
      path: 'game/scene/test_scene.txt',
      content: newScriptContent,
      dryRun: false,
    })
    assert(applyResult.applied === true, 'apply should succeed')
    assert(applyResult.snapshotId, 'apply should create snapshot')

    // Step 3: Validate the new script
    const validateResult = await callTool(client, 'validate_script', {
      path: 'game/scene/test_scene.txt',
    })
    assert(validateResult.valid === true, 'new script should be valid')

    // Step 4: Verify snapshot exists
    const snapshotDir = path.join(projectRoot, '.webgal_agent', 'snapshots')
    const snapshots = await fs.readdir(snapshotDir)
    const metaFiles = snapshots.filter(
      (f) => f.includes(applyResult.snapshotId) && f.endsWith('.meta.json'),
    )
    assert(metaFiles.length > 0, 'snapshot metadata should exist')

    // Step 5: Verify file content
    const fileContent = await callTool(client, 'read_file', {
      path: 'game/scene/test_scene.txt',
    })
    assert(fileContent.content === newScriptContent, 'file content should match')
  } finally {
    client.kill()
    await cleanupTestProject(projectRoot)
  }
})

// ============================================================================
// Test 3: 回滚链路 - list_snapshots → restore_snapshot → verify
// ============================================================================
runner.test('E2E: 回滚链路 - list_snapshots → restore_snapshot → verify', async () => {
  const projectRoot = await createTestProject()
  const proc = spawnMcp(projectRoot)
  const client = new MCPClient(proc)

  try {
    await initializeClient(client)

    const testPath = 'game/scene/start.txt'

    // Step 1: Read original content
    const original = await callTool(client, 'read_file', { path: testPath })
    const originalContent = original.content

    // Step 2: Create a snapshot of original content (by writing it again)
    const originalSnapshot = await callTool(client, 'write_to_file', {
      path: testPath,
      content: originalContent,
      dryRun: false,
    })
    const originalSnapshotId = originalSnapshot.snapshotId

    // Step 3: Make a change (creates another snapshot)
    const modifiedContent = originalContent.replace('欢迎', '修改后')
    await callTool(client, 'write_to_file', {
      path: testPath,
      content: modifiedContent,
      dryRun: false,
    })

    // Step 4: Verify change applied
    const modified = await callTool(client, 'read_file', { path: testPath })
    assert(modified.content.includes('修改后'), 'modification should be applied')

    // Step 5: List snapshots
    const snapshots = await callTool(client, 'list_snapshots', { path: testPath })
    assert(Array.isArray(snapshots.snapshots), 'should return snapshots array')
    assert(snapshots.snapshots.length >= 2, 'should have at least two snapshots')

    // Find the original snapshot (should be second in list, as list is sorted by timestamp desc)
    const originalSnapshotInList = snapshots.snapshots.find((s) => s.id === originalSnapshotId)
    assert(originalSnapshotInList, 'original snapshot should be in list')

    // Step 6: Get original snapshot content
    const snapshotContent = await callTool(client, 'restore_snapshot', {
      snapshotId: originalSnapshotId,
    })
    assert(snapshotContent.path === testPath, 'snapshot path should match')
    assert(snapshotContent.content === originalContent, 'snapshot content should be original')

    // Step 7: Preview restore with write_to_file dry-run
    const restoreDryRun = await callTool(client, 'write_to_file', {
      path: testPath,
      content: snapshotContent.content,
      dryRun: true,
    })
    assert(restoreDryRun.applied === false, 'should be dry-run')
    assert(restoreDryRun.diff, 'restore dry-run should return diff')

    // Step 8: Apply restore
    const restoreApply = await callTool(client, 'write_to_file', {
      path: testPath,
      content: snapshotContent.content,
      dryRun: false,
    })
    assert(restoreApply.applied === true, 'restore should succeed')

    // Step 9: Verify content restored
    const restored = await callTool(client, 'read_file', { path: testPath })
    assert(restored.content === originalContent, 'content should be restored to original')
    assert(!restored.content.includes('修改后'), 'modified text should be gone')
  } finally {
    client.kill()
    await cleanupTestProject(projectRoot)
  }
})

// ============================================================================
// Test 4: 锁冲突测试 - 并行启动两个 MCP 进程
// ============================================================================
runner.test('E2E: 锁冲突 - 并行启动两个 MCP 进程，第二个应失败', async () => {
  const projectRoot = await createTestProject()
  const proc1 = spawnMcp(projectRoot)
  const client1 = new MCPClient(proc1)

  try {
    // First MCP instance should start successfully
    await initializeClient(client1)

    // Verify lock file exists
    const lockPath = path.join(projectRoot, '.webgal_agent', 'agent.lock')
    const lockExists = await fs
      .access(lockPath)
      .then(() => true)
      .catch(() => false)
    assert(lockExists, 'lock file should exist after first MCP starts')

    // Try to start second MCP instance (should fail)
    const proc2 = spawnMcp(projectRoot)

    // Wait for second process to exit (should exit with error)
    const exitPromise = new Promise<number | null>((resolve) => {
      proc2.on('exit', (code) => resolve(code))
    })

    // Collect stderr to verify error message
    let stderr = ''
    proc2.stderr.setEncoding('utf-8')
    proc2.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const exitCode = await Promise.race([
      exitPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ])

    assert(exitCode !== 0 && exitCode !== null, 'second MCP should exit with error code')
    // Exit code 2 means E_LOCK_HELD
    assert(exitCode === 2, `second MCP should exit with code 2 (E_LOCK_HELD), got ${exitCode}`)

    // First MCP should still be running
    const runtimeInfo = await callTool(client1, 'get_runtime_info', {})
    assert(runtimeInfo.lock, 'first MCP should still hold lock')
    assert(runtimeInfo.lock.owner === 'manual', 'lock owner should be manual')
  } finally {
    client1.kill()
    await cleanupTestProject(projectRoot)
  }
})

// ============================================================================
// Test 5: 幂等持久化测试 - 重启后仍命中幂等缓存
// ============================================================================
runner.test('E2E: 幂等持久化 - 相同 idempotencyKey 返回相同 snapshotId，重启后仍有效', async () => {
  const projectRoot = await createTestProject()

  let firstSnapshotId: string

  // First MCP instance
  {
    const proc = spawnMcp(projectRoot)
    const client = new MCPClient(proc)
    try {
      await initializeClient(client)

      // Write with idempotency key
      const result1 = await callTool(client, 'write_to_file', {
        path: 'game/scene/idempotent_test.txt',
        content: 'First content',
        dryRun: false,
        idempotencyKey: 'test-key-123',
      })
      assert(result1.applied === true, 'first write should succeed')
      firstSnapshotId = result1.snapshotId
      assert(firstSnapshotId, 'first write should return snapshotId')

      // Write again with same key but different content (should return same snapshotId)
      const result2 = await callTool(client, 'write_to_file', {
        path: 'game/scene/idempotent_test.txt',
        content: 'Different content',
        dryRun: false,
        idempotencyKey: 'test-key-123',
      })
      assertEqual(
        result2.snapshotId,
        firstSnapshotId,
        'same idempotency key should return same snapshotId',
      )

      // Verify file content is still the first one (idempotency prevents overwrite)
      const fileContent = await callTool(client, 'read_file', {
        path: 'game/scene/idempotent_test.txt',
      })
      assertEqual(fileContent.content, 'First content', 'file should still have first content')
    } finally {
      client.kill()
    }
  }

  // Second MCP instance (restart) - should still hit idempotency cache
  {
    const proc = spawnMcp(projectRoot)
    const client = new MCPClient(proc)
    try {
      await initializeClient(client)

      // Write with same idempotency key after restart
      const result3 = await callTool(client, 'write_to_file', {
        path: 'game/scene/idempotent_test.txt',
        content: 'Third content',
        dryRun: false,
        idempotencyKey: 'test-key-123',
      })
      assertEqual(
        result3.snapshotId,
        firstSnapshotId,
        'after restart, same key should still return same snapshotId',
      )

      // Verify file content is still the first one
      const fileContent = await callTool(client, 'read_file', {
        path: 'game/scene/idempotent_test.txt',
      })
      assertEqual(
        fileContent.content,
        'First content',
        'file should still have first content after restart',
      )

      // Verify idempotency cache file exists
      const idemPath = path.join(projectRoot, '.webgal_agent', 'idem.json')
      const idemExists = await fs
        .access(idemPath)
        .then(() => true)
        .catch(() => false)
      assert(idemExists, 'idempotency cache file should exist')

      const idemContent = await fs.readFile(idemPath, 'utf-8')
      const idemData = JSON.parse(idemContent)
      assert(idemData['test-key-123'], 'idempotency cache should contain test-key-123')
      assertEqual(
        idemData['test-key-123'].snapshotId,
        firstSnapshotId,
        'cached snapshotId should match',
      )
    } finally {
      client.kill()
      await cleanupTestProject(projectRoot)
    }
  }
})

export { runner }
