/**
 * 测试工具函数
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * 创建临时测试项目
 */
export async function createTestProject(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webgal-test-'));
  
  // 创建基本目录结构
  await fs.mkdir(path.join(tmpDir, 'game'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'game/scene'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'game/background'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'game/figure'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'game/bgm'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'game/vocal'), { recursive: true });

  // 创建一些测试资源
  await fs.writeFile(
    path.join(tmpDir, 'game/background/beach.jpg'),
    'fake-image-data',
    'utf-8'
  );
  await fs.writeFile(
    path.join(tmpDir, 'game/figure/yukino.png'),
    'fake-image-data',
    'utf-8'
  );
  await fs.writeFile(
    path.join(tmpDir, 'game/bgm/beach_bgm.mp3'),
    'fake-audio-data',
    'utf-8'
  );

  // 创建初始场景
  await fs.writeFile(
    path.join(tmpDir, 'game/scene/start.txt'),
    ':欢迎来到 WebGAL;\n',
    'utf-8'
  );

  // 创建 package.json
  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      scripts: {
        dev: 'echo "Dev server started on http://localhost:3001"',
        build: 'echo "Build complete"',
        lint: 'echo "Lint passed"',
        'dev-no-port': 'echo "Server started without port info"',
        sleep: 'node -e "setTimeout(() => {}, 60000)"',
        'not-whitelisted': 'echo "This should not run"',
      },
    }, null, 2),
    'utf-8'
  );

  return tmpDir;
}

/**
 * 清理测试项目
 */
export async function cleanupTestProject(projectRoot: string): Promise<void> {
  try {
    await fs.rm(projectRoot, { recursive: true, force: true });
  } catch (err) {
    console.warn('Failed to cleanup test project:', err);
  }
}

/**
 * 断言函数
 */
export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message || ''}\nExpected: ${expected}\nActual: ${actual}`
    );
  }
}

export function assertDeepEqual(actual: any, expected: any, message?: string): void {
  const actualStr = JSON.stringify(actual, null, 2);
  const expectedStr = JSON.stringify(expected, null, 2);

  if (actualStr !== expectedStr) {
    throw new Error(
      `Assertion failed: ${message || ''}\nExpected: ${expectedStr}\nActual: ${actualStr}`
    );
  }
}

/**
 * 断言对象只包含指定的键（契约形状检查）
 */
export function assertOnlyKeys(obj: any, allowedKeys: string[], message?: string): void {
  const actualKeys = Object.keys(obj);
  const extraKeys = actualKeys.filter(k => !allowedKeys.includes(k));

  if (extraKeys.length > 0) {
    throw new Error(
      `Assertion failed: ${message || 'Object has unexpected keys'}\n` +
      `  Allowed: ${allowedKeys.join(', ')}\n` +
      `  Extra: ${extraKeys.join(', ')}`
    );
  }
}

/**
 * 断言 Promise 抛出指定错误码
 */
export async function expectToolError(promise: Promise<any>, expectedCode: string): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected error with code ${expectedCode}, but no error was thrown`);
  } catch (err: any) {
    if (!err.error || err.error.code !== expectedCode) {
      throw new Error(
        `Expected error code ${expectedCode}, but got: ${err.error?.code || 'no error code'}\n` +
        `Message: ${err.error?.message || err.message}`
      );
    }
  }
}

/**
 * 创建大文件（用于测试大小限制）
 */
export async function createLargeFile(projectRoot: string, relativePath: string, sizeBytes: number): Promise<void> {
  const fullPath = path.join(projectRoot, relativePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });

  const chunk = 'x'.repeat(1024);
  const chunks = Math.ceil(sizeBytes / 1024);
  let content = '';
  for (let i = 0; i < chunks; i++) {
    content += chunk;
  }
  content = content.slice(0, sizeBytes);

  await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * 修改文件（用于并发冲突测试）
 */
export async function mutateFile(projectRoot: string, relativePath: string, newContent: string): Promise<void> {
  const fullPath = path.join(projectRoot, relativePath);
  await fs.writeFile(fullPath, newContent, 'utf-8');
}

/**
 * 测试运行器
 */
export class TestRunner {
  private tests: Array<{ name: string; fn: () => Promise<void> }> = [];
  private passed = 0;
  private failed = 0;

  test(name: string, fn: () => Promise<void>): void {
    this.tests.push({ name, fn });
  }

  async run(): Promise<void> {
    console.log(`\n🧪 Running ${this.tests.length} tests...\n`);

    for (const test of this.tests) {
      try {
        await test.fn();
        this.passed++;
        console.log(`✅ ${test.name}`);
      } catch (err) {
        this.failed++;
        console.log(`❌ ${test.name}`);
        console.error(`   ${(err as Error).message}\n`);
      }
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed\n`);

    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

