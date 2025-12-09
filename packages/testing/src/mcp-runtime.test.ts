/**
 * MCP get_runtime_info 集成测试（换行分隔 JSON over stdio）
 */

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import * as path from 'node:path'
import {
  TestRunner,
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  assertOnlyKeys,
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
      }, 8000)
    })
  }
}

function spawnMcp(projectRoot: string, extraArgs: string[] = []) {
  // packages/testing -> packages/mcp-webgal
  const mcpBin = path.resolve(process.cwd(), '../mcp-webgal/src/bin.ts')
  const proc = spawn('node', ['--import', 'tsx', mcpBin, '--project', projectRoot, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  return proc
}

runner.test('get_runtime_info: default (exec/browser disabled) shape and redaction', async () => {
  const projectRoot = await createTestProject()
  const proc = spawnMcp(projectRoot)
  const client = new MCPClient(proc)
  try {
    // initialize
    const init = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    })
    assertEqual(init.result?.capabilities?.tools !== undefined, true, 'initialize ok')

    // call get_runtime_info
    const resp = await client.send('tools/call', { name: 'get_runtime_info', arguments: {} })
    const content = resp.result?.content?.[0]?.text
    assert(typeof content === 'string', 'content text should exist')
    const info = JSON.parse(content)

    // shape
    assertEqual(typeof info.projectRoot, 'string')
    assertEqual(typeof info.snapshotRetention, 'number')
    assertOnlyKeys(info.sandbox, ['forbiddenDirs', 'maxReadBytes', 'textEncoding'])

    // execution/browser omitted when disabled
    assert(info.execution === undefined, 'execution must be omitted when disabled')
    assert(info.browser === undefined, 'browser must be omitted when disabled')

    // tools list includes get_runtime_info
    assert(
      Array.isArray(info.tools) && info.tools.includes('get_runtime_info'),
      'tools should contain get_runtime_info',
    )

    // no sensitive redactEnv anywhere
    assert(JSON.stringify(info).includes('redactEnv') === false, 'redactEnv must be redacted')
  } finally {
    proc.kill()
    await cleanupTestProject(projectRoot)
  }
})

runner.test('get_runtime_info: includes exec/browser when enabled via CLI', async () => {
  const projectRoot = await createTestProject()
  const proc = spawnMcp(projectRoot, ['--enable-exec', '--enable-browser'])
  const client = new MCPClient(proc)
  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    })
    const resp = await client.send('tools/call', { name: 'get_runtime_info', arguments: {} })
    const info = JSON.parse(resp.result?.content?.[0]?.text || '{}')

    assert(info.execution && info.execution.enabled === true, 'execution.enabled should be true')
    assert(info.browser && info.browser.enabled === true, 'browser.enabled should be true')
    assert(Array.isArray(info.execution.allowedCommands), 'allowedCommands present')
    assert(typeof info.browser.timeoutMs === 'number', 'browser.timeoutMs present')

    // sensitive field still not exposed
    assert(JSON.stringify(info).includes('redactEnv') === false, 'redactEnv must be redacted')
  } finally {
    proc.kill()
    await cleanupTestProject(projectRoot)
  }
})

export { runner }
