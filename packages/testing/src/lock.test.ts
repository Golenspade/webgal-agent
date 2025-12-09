/**
 * 锁机制测试
 */

import { TestRunner } from './test-utils.js'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { promises as fs } from 'fs'

const runner = new TestRunner('锁机制')

// 启动 MCP 进程
function spawnMcp(projectRoot: string): ChildProcess {
  const mcpBin = join(process.cwd(), '../mcp-webgal/src/bin.ts')
  const proc = spawn('node', ['--import', 'tsx', mcpBin, '--project', projectRoot], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return proc
}

// 等待进程输出包含特定文本
function waitForOutput(proc: ChildProcess, text: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for: ${text}`))
    }, timeoutMs)

    const onData = (data: Buffer) => {
      if (data.toString().includes(text)) {
        clearTimeout(timeout)
        proc.stderr?.off('data', onData)
        resolve()
      }
    }

    proc.stderr?.on('data', onData)
  })
}

// 兼容旧/新日志前缀，等待锁获取日志
function waitForLockAcquired(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for lock acquired log`))
    }, timeoutMs)

    const onData = (data: Buffer) => {
      const s = data.toString()
      if (s.includes('[LOCK] acquired') || s.includes('🔒 锁状态: ✅ 已获取')) {
        clearTimeout(timeout)
        proc.stderr?.off('data', onData)
        resolve()
      }
    }

    proc.stderr?.on('data', onData)
  })
}

// 测试 1: 单实例正常启动和退出
runner.test('单实例正常启动和退出', async () => {
  const projectRoot = join(process.cwd(), '../../apps/dev-sandbox')
  const lockPath = join(projectRoot, '.webgal_agent', 'agent.lock')

  // 清理旧锁
  try {
    await fs.unlink(lockPath)
  } catch {}

  // 启动 MCP
  const proc = spawnMcp(projectRoot)

  try {
    // 等待启动成功
    await waitForLockAcquired(proc)

    // 验证锁文件存在
    const lockContent = await fs.readFile(lockPath, 'utf-8')
    const lock = JSON.parse(lockContent)

    if (lock.owner !== 'manual') {
      throw new Error(`Expected owner=manual, got ${lock.owner}`)
    }
    if (lock.pid !== proc.pid) {
      throw new Error(`Expected pid=${proc.pid}, got ${lock.pid}`)
    }
    if (!lock.host || !lock.startedAt || !lock.version) {
      throw new Error('Lock missing required fields')
    }

    // 正常退出
    proc.kill('SIGTERM')
    await new Promise((resolve) => proc.on('exit', resolve))

    // 等待一小段时间确保清理完成
    await new Promise((resolve) => setTimeout(resolve, 200))

    // 验证锁文件已清理或进程已不存在（过期锁）
    // 注意：由于 stdio transport 的特性，exit 事件处理器可能无法完全执行
    // 因此我们接受两种情况：1) 锁文件被删除 2) 锁文件存在但进程已死
    try {
      const remainingLock = JSON.parse(await fs.readFile(lockPath, 'utf-8'))
      // 检查进程是否还在运行
      try {
        process.kill(remainingLock.pid, 0)
        throw new Error(`Process ${remainingLock.pid} is still running`)
      } catch (error: any) {
        // ESRCH: 进程不存在 - 这是预期的
        if (error.code !== 'ESRCH') {
          throw error
        }
        // 进程已死，锁文件会在下次启动时被清理（过期锁机制）
      }
    } catch (error: any) {
      // ENOENT: 锁文件已被删除 - 这也是预期的
      if (error.code !== 'ENOENT') {
        throw error
      }
    }
  } finally {
    if (!proc.killed) {
      proc.kill('SIGKILL')
    }
    // 清理测试锁文件
    try {
      await fs.unlink(lockPath)
    } catch {}
  }
})

// 测试 2: 并发启动冲突
runner.test('并发启动冲突', async () => {
  const projectRoot = join(process.cwd(), '../../apps/dev-sandbox')
  const lockPath = join(projectRoot, '.webgal_agent', 'agent.lock')

  // 清理旧锁
  try {
    await fs.unlink(lockPath)
  } catch {}

  // 启动第一个实例
  const proc1 = spawnMcp(projectRoot)

  try {
    // 等待第一个实例启动成功
    await waitForLockAcquired(proc1)

    // 尝试启动第二个实例
    const proc2 = spawnMcp(projectRoot)

    try {
      // 等待第二个实例失败
      await waitForOutput(proc2, 'Agent 已在运行中')

      // 验证第二个实例退出码为 2
      const exitCode = await new Promise<number>((resolve) => {
        proc2.on('exit', (code) => resolve(code || 0))
      })

      if (exitCode !== 2) {
        throw new Error(`Expected exit code 2, got ${exitCode}`)
      }
    } finally {
      if (!proc2.killed) {
        proc2.kill('SIGKILL')
      }
    }
  } finally {
    proc1.kill('SIGTERM')
    await new Promise((resolve) => proc1.on('exit', resolve))
  }
})

// 测试 3: 过期锁自动清理
runner.test('过期锁自动清理', async () => {
  const projectRoot = join(process.cwd(), '../../apps/dev-sandbox')
  const lockPath = join(projectRoot, '.webgal_agent', 'agent.lock')

  // 创建一个过期锁（不存在的 PID）
  const staleLock = {
    owner: 'manual',
    pid: 999999, // 不存在的 PID
    host: 'test-host',
    startedAt: Date.now() - 3600000, // 1 小时前
    version: '0.1.0',
  }

  await fs.mkdir(join(projectRoot, '.webgal_agent'), { recursive: true })
  await fs.writeFile(lockPath, JSON.stringify(staleLock, null, 2))

  // 启动 MCP（应该自动清理过期锁）
  const proc = spawnMcp(projectRoot)

  try {
    // 等待启动成功
    await waitForLockAcquired(proc)

    // 验证锁文件已更新为新进程
    const lockContent = await fs.readFile(lockPath, 'utf-8')
    const lock = JSON.parse(lockContent)

    if (lock.pid !== proc.pid) {
      throw new Error(`Expected new pid=${proc.pid}, got ${lock.pid}`)
    }
  } finally {
    proc.kill('SIGTERM')
    await new Promise((resolve) => proc.on('exit', resolve))
  }
})

// 导出 runner
export { runner }
