/**
 * 工具桥测试（沙箱、命令执行、浏览器）
 */

import { FsSandbox, CommandExecutor, BrowserController } from '@webgal-agent/tool-bridge';
import {
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  expectToolError,
  TestRunner,
} from './test-utils.js';

const runner = new TestRunner();

// FsSandbox 测试
runner.test('FsSandbox: should reject absolute paths', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const sandbox = new FsSandbox({
      projectRoot,
      forbiddenDirs: ['.git'],
      maxReadBytes: 1048576,
      textEncoding: 'utf-8',
    });

    try {
      sandbox.validatePath('/etc/passwd');
      throw new Error('Should have thrown E_DENY_PATH');
    } catch (err: any) {
      assertEqual(err.error.code, 'E_DENY_PATH');
    }
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('FsSandbox: should reject parent directory traversal', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const sandbox = new FsSandbox({
      projectRoot,
      forbiddenDirs: ['.git'],
      maxReadBytes: 1048576,
      textEncoding: 'utf-8',
    });

    try {
      sandbox.validatePath('../../../etc/passwd');
      throw new Error('Should have thrown E_DENY_PATH');
    } catch (err: any) {
      assertEqual(err.error.code, 'E_DENY_PATH');
    }
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('FsSandbox: should reject forbidden directories', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const sandbox = new FsSandbox({
      projectRoot,
      forbiddenDirs: ['.git', 'node_modules', '.env'],
      maxReadBytes: 1048576,
      textEncoding: 'utf-8',
    });

    const forbidden = ['.git/config', 'node_modules/pkg/index.js', '.env'];
    
    for (const path of forbidden) {
      try {
        sandbox.validatePath(path);
        throw new Error(`Should have rejected ${path}`);
      } catch (err: any) {
        assertEqual(err.error.code, 'E_DENY_PATH', `Should reject ${path}`);
      }
    }
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// CommandExecutor 测试
runner.test('CommandExecutor: should execute whitelisted command', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const executor = new CommandExecutor({
      enabled: true,
      allowedCommands: ['dev', 'build', 'lint'],
      timeoutMs: 10000,
      workingDir: projectRoot,
      redactEnv: [],
    });

    const result = await executor.execute('build');
    
    assertEqual(result.ok, true);
    assert(result.logs.length > 0, 'should have logs');
    assert(result.logs.some(l => l.includes('Build complete')), 'should contain build output');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('CommandExecutor: should reject non-whitelisted command', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const executor = new CommandExecutor({
      enabled: true,
      allowedCommands: ['dev', 'build', 'lint'],
      timeoutMs: 10000,
      workingDir: projectRoot,
      redactEnv: [],
    });

    await expectToolError(
      executor.execute('not-whitelisted'),
      'E_POLICY_VIOLATION'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('CommandExecutor: should timeout long-running command', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const executor = new CommandExecutor({
      enabled: true,
      allowedCommands: ['sleep'],
      timeoutMs: 1000, // 1 second
      workingDir: projectRoot,
      redactEnv: [],
    });

    await expectToolError(
      executor.execute('sleep'),
      'E_TIMEOUT'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('CommandExecutor: collectAllowedCommands should read package.json', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const commands = await CommandExecutor.collectAllowedCommands(projectRoot);
    
    assert(commands.includes('dev'), 'should include dev');
    assert(commands.includes('build'), 'should include build');
    assert(commands.includes('lint'), 'should include lint');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('CommandExecutor: executeStream should support early return', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const executor = new CommandExecutor({
      enabled: true,
      allowedCommands: ['dev'],
      timeoutMs: 10000,
      workingDir: projectRoot,
      redactEnv: [],
    });

    const result = await executor.executeStream('dev', [], {
      earlyReturnPattern: /localhost:(\d+)/,
      earlyReturnTimeoutMs: 5000,
      keepAlive: false,
    });
    
    assertEqual(result.ok, true);
    assert(result.logs.some(l => l.includes('localhost:3001')), 'should match pattern');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('CommandExecutor: executeStream should timeout if pattern not matched', async () => {
  const projectRoot = await createTestProject();

  try {
    // 修改 package.json 添加长时间运行但不输出端口的脚本
    const fs = await import('fs/promises');
    const path = await import('path');
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    pkg.scripts['dev-no-port'] = 'node -e "setInterval(() => console.log(\'tick\'), 500)"';
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

    const executor = new CommandExecutor({
      enabled: true,
      allowedCommands: ['dev-no-port'],
      timeoutMs: 10000,
      workingDir: projectRoot,
      redactEnv: [],
    });

    await expectToolError(
      executor.executeStream('dev-no-port', [], {
        earlyReturnPattern: /localhost:(\d+)/,
        earlyReturnTimeoutMs: 2000,
        keepAlive: false,
      }),
      'E_TIMEOUT'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// BrowserController 测试
runner.test('BrowserController: should validate localhost URLs', async () => {
  const controller = new BrowserController({
    enabled: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    screenshotDir: 'screenshots',
    timeoutMs: 30000,
  });

  const validUrls = [
    'http://localhost:3000',
    'http://127.0.0.1:8080',
    'https://localhost',
  ];

  for (const url of validUrls) {
    // Should not throw
    controller.validateUrl(url);
  }
});

runner.test('BrowserController: should reject external URLs', async () => {
  const controller = new BrowserController({
    enabled: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    screenshotDir: 'screenshots',
    timeoutMs: 30000,
  });

  const invalidUrls = [
    'http://example.com',
    'https://google.com',
    'http://192.168.1.1',
  ];

  for (const url of invalidUrls) {
    try {
      controller.validateUrl(url);
      throw new Error(`Should have rejected ${url}`);
    } catch (err: any) {
      assertEqual(err.error.code, 'E_POLICY_VIOLATION', `Should reject ${url}`);
    }
  }
});

runner.test('BrowserController: should validate request parameters', async () => {
  const controller = new BrowserController({
    enabled: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    screenshotDir: 'screenshots',
    timeoutMs: 30000,
  });

  // click without selector
  try {
    controller.validateRequest({
      action: 'click',
      url: 'http://localhost:3000',
    });
    throw new Error('Should have thrown E_BAD_ARGS');
  } catch (err: any) {
    assertEqual(err.error.code, 'E_BAD_ARGS');
  }

  // screenshot without path
  try {
    controller.validateRequest({
      action: 'screenshot',
      url: 'http://localhost:3000',
    });
    throw new Error('Should have thrown E_BAD_ARGS');
  } catch (err: any) {
    assertEqual(err.error.code, 'E_BAD_ARGS');
  }
});

runner.test('BrowserController: should reject when disabled', async () => {
  const controller = new BrowserController({
    enabled: false,
    allowedHosts: ['localhost'],
    screenshotDir: 'screenshots',
    timeoutMs: 30000,
  });

  try {
    controller.validateRequest({
      action: 'open',
      url: 'http://localhost:3000',
    });
    throw new Error('Should have thrown E_TOOL_DISABLED');
  } catch (err: any) {
    assertEqual(err.error.code, 'E_TOOL_DISABLED');
  }
});

export { runner };

