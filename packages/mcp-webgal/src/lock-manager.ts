/**
 * Agent Lock Manager
 * 
 * 管理 .webgal_agent/agent.lock 文件，确保同一项目根只有一个 MCP 实例运行
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { hostname } from 'os';

export type LockOwner = 'cline' | 'terre' | 'manual';

export interface AgentLock {
  owner: LockOwner;
  pid: number;
  host: string;
  startedAt: number;
  version: string;
}

const LOCK_DIR = '.webgal_agent';
const LOCK_FILE = 'agent.lock';

/**
 * 获取锁文件路径
 */
function getLockPath(projectRoot: string): string {
  return join(projectRoot, LOCK_DIR, LOCK_FILE);
}

/**
 * 确保 .webgal_agent 目录存在
 */
async function ensureLockDir(projectRoot: string): Promise<void> {
  const lockDir = join(projectRoot, LOCK_DIR);
  try {
    await fs.mkdir(lockDir, { recursive: true });
  } catch (error: any) {
    // 目录已存在，忽略错误
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * 检查进程是否仍在运行（跨平台）
 */
function isProcessRunning(pid: number): boolean {
  try {
    // process.kill(pid, 0) 不会真正杀死进程，只是检查进程是否存在
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // ESRCH: 进程不存在
    // EPERM: 进程存在但无权限（仍然算运行中）
    return error.code === 'EPERM';
  }
}

/**
 * 读取锁文件
 */
export async function checkLock(projectRoot: string): Promise<AgentLock | null> {
  const lockPath = getLockPath(projectRoot);
  
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const lock: AgentLock = JSON.parse(content);
    
    // 检查锁是否过期（进程已不存在）
    if (!isProcessRunning(lock.pid)) {
      // 进程已死，清理过期锁
      await releaseLock(projectRoot);
      return null;
    }
    
    return lock;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // 锁文件不存在
      return null;
    }
    throw error;
  }
}

/**
 * 获取锁（原子操作）
 * 
 * @throws 如果锁已被占用
 */
export async function acquireLock(
  projectRoot: string,
  owner: LockOwner = 'manual',
  version: string = '0.1.0'
): Promise<void> {
  await ensureLockDir(projectRoot);
  
  const lockPath = getLockPath(projectRoot);
  
  // 先检查是否已有锁
  const existingLock = await checkLock(projectRoot);
  if (existingLock) {
    const error: any = new Error(
      `Agent 已在运行中！\n` +
      `  Owner: ${existingLock.owner}\n` +
      `  PID: ${existingLock.pid}\n` +
      `  Host: ${existingLock.host}\n` +
      `  Started: ${new Date(existingLock.startedAt).toLocaleString()}\n\n` +
      `请先停止现有实例，或等待其完成。`
    );
    error.code = 'E_LOCK_HELD';
    error.lock = existingLock;
    throw error;
  }
  
  // 创建锁
  const lock: AgentLock = {
    owner,
    pid: process.pid,
    host: hostname(),
    startedAt: Date.now(),
    version,
  };
  
  try {
    // 使用 wx 标志：如果文件已存在则失败（原子操作）
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2), { flag: 'wx' });
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      // 竞态条件：另一个进程刚刚创建了锁
      const existingLock = await checkLock(projectRoot);
      const err: any = new Error(
        `Agent 已在运行中（竞态条件）！\n` +
        `  Owner: ${existingLock?.owner}\n` +
        `  PID: ${existingLock?.pid}\n` +
        `  Host: ${existingLock?.host}`
      );
      err.code = 'E_LOCK_HELD';
      err.lock = existingLock;
      throw err;
    }
    throw error;
  }
}

/**
 * 释放锁
 */
export async function releaseLock(projectRoot: string): Promise<void> {
  const lockPath = getLockPath(projectRoot);
  
  try {
    await fs.unlink(lockPath);
  } catch (error: any) {
    // 锁文件不存在，忽略错误
    if (error.code !== 'ENOENT') {
      console.error(`警告: 释放锁失败: ${error.message}`);
    }
  }
}

/**
 * 注册进程退出时自动释放锁
 */
export function registerLockCleanup(projectRoot: string): void {
  const cleanup = () => {
    // 同步版本的释放锁（因为进程退出时异步操作可能不完整）
    try {
      const lockPath = getLockPath(projectRoot);
      const { unlinkSync } = require('fs');
      unlinkSync(lockPath);
    } catch (error: any) {
      // 忽略错误
    }
  };
  
  // 正常退出
  process.on('exit', cleanup);
  
  // Ctrl+C
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130); // 128 + SIGINT(2)
  });
  
  // kill 命令
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143); // 128 + SIGTERM(15)
  });
  
  // 未捕获的异常
  process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    cleanup();
    process.exit(1);
  });
}

