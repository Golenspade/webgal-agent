/**
 * 工具测试用例
 * 测试 write_to_file、replace_in_file、validate_script 等关键功能
 */

import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import { DEFAULT_SANDBOX_CONFIG } from '@webgal-agent/tool-bridge';
import {
  TestRunner,
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
} from './test-utils.js';

const runner = new TestRunner();

// 测试 1: write_to_file - dryRun 返回 diff
runner.test('write_to_file: dryRun should return diff', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    // Dry-run 写入
    const result = await tools.writeToFile({
      path: 'game/scene/test.txt',
      content: 'changeBg: beach.jpg -next;\n雪乃: 你好;\n',
      dryRun: true,
    });

    assert(!result.applied, 'Should not be applied in dry-run mode');
    assert(result.diff !== undefined, 'Should return diff');
    assert(result.snapshotId === undefined, 'Should not have snapshotId in dry-run');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 2: write_to_file - 实际写入返回 snapshotId
runner.test('write_to_file: actual write should return snapshotId', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    const content = 'changeBg: beach.jpg -next;\n雪乃: 你好;\n';

    // 先 dry-run
    await tools.writeToFile({
      path: 'game/scene/test.txt',
      content,
      dryRun: true,
    });

    // 实际写入
    const result = await tools.writeToFile({
      path: 'game/scene/test.txt',
      content,
      dryRun: false,
      idempotencyKey: 'test-key-1',
    });

    assert(result.applied, 'Should be applied');
    assert(result.snapshotId !== undefined, 'Should have snapshotId');
    assert(result.snapshotId!.startsWith('snap_'), 'SnapshotId should have correct format');
    assert(result.bytesWritten! > 0, 'Should have bytesWritten');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 3: write_to_file - 幂等性
runner.test('write_to_file: idempotency should prevent duplicate writes', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    const content = 'changeBg: beach.jpg -next;\n雪乃: 你好;\n';
    const idempotencyKey = 'test-key-2';

    // 第一次写入
    const result1 = await tools.writeToFile({
      path: 'game/scene/test.txt',
      content,
      dryRun: false,
      idempotencyKey,
    });

    // 第二次写入（相同 key）
    const result2 = await tools.writeToFile({
      path: 'game/scene/test.txt',
      content,
      dryRun: false,
      idempotencyKey,
    });

    assertEqual(result1.snapshotId, result2.snapshotId, 'Should return same snapshotId');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 4: replace_in_file - 返回替换次数
runner.test('replace_in_file: should return replacement count', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    // 先写入测试文件
    await tools.writeToFile({
      path: 'game/scene/test.txt',
      content: '雪乃: 你好;\n雪乃: 再见;\n',
      dryRun: false,
    });

    // 替换
    const result = await tools.replaceInFile({
      path: 'game/scene/test.txt',
      find: '雪乃',
      replace: '由比滨',
    });

    assertEqual(result.count, 2, 'Should replace 2 occurrences');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 5: validate_script - 检测缺少分号
runner.test('validate_script: should detect missing semicolons', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    const result = await tools.validateScript({
      content: 'changeBg: beach.jpg\n雪乃: 你好\n',
    });

    assert(!result.valid, 'Should be invalid');
    assert(result.diagnostics.length === 2, 'Should have 2 diagnostics');
    assert(
      result.diagnostics.every(d => d.kind === 'syntax'),
      'All diagnostics should be syntax errors'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 6: validate_script - 检测资源缺失
runner.test('validate_script: should detect missing resources', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    const result = await tools.validateScript({
      content: 'changeBg: nonexistent.jpg;\n',
    });

    assert(!result.valid, 'Should be invalid');
    assert(result.diagnostics.length > 0, 'Should have diagnostics');
    assert(
      result.diagnostics.some(d => d.kind === 'resource'),
      'Should have resource error'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 7: list_project_resources
runner.test('list_project_resources: should list all resources', async () => {
  const projectRoot = await createTestProject();

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    const result = await tools.listProjectResources();

    assert(result.backgrounds.includes('beach.jpg'), 'Should include beach.jpg');
    assert(result.figures.includes('yukino.png'), 'Should include yukino.png');
    assert(result.bgm.includes('beach_bgm.mp3'), 'Should include beach_bgm.mp3');
    assert(result.scenes.includes('start.txt'), 'Should include start.txt');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 8: search_files
runner.test('search_files: should find matches across files', async () => {
  const projectRoot = await createTestProject();

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    // 先写入一些测试文件
    await tools.writeToFile({
      path: 'game/scene/test1.txt',
      content: '雪乃: 你好;\n雪乃: 再见;\n',
      dryRun: false,
    });

    await tools.writeToFile({
      path: 'game/scene/test2.txt',
      content: '由比滨: 你好;\n雪乃: 嗨;\n',
      dryRun: false,
    });

    // 搜索
    const result = await tools.searchFiles({
      path: 'game/scene',
      regex: '雪乃',
      filePattern: '**/*.txt',
      maxMatches: 100,
    });

    assert(result.matches.length >= 3, 'Should find at least 3 matches');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 9: preview_scene (端口解析)
runner.test('preview_scene: should extract port from logs', async () => {
  const projectRoot = await createTestProject();

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
      execution: {
        enabled: true,
        allowedCommands: ['dev', 'build', 'lint'],
        timeoutMs: 180000,
        workingDir: projectRoot,
        redactEnv: [],
      },
    });

    const result = await tools.previewScene({
      scenePath: 'game/scene/start.txt',
    });

    assert(result.url.includes('localhost'), 'URL should contain localhost');
    assert(result.url.includes('3001'), 'URL should contain port 3001');
    assert(result.url.includes('scene=start'), 'URL should contain scene parameter');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试快照工具的错误处理
runner.test('listSnapshots: should validate parameters', async () => {
  const projectRoot = await createTestProject();

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    // 测试无效的 limit 类型
    let errorThrown = false;
    try {
      await tools.listSnapshots({ limit: 'invalid' as any });
    } catch (err: any) {
      errorThrown = true;
      assertEqual(err.error.code, 'E_BAD_ARGS', 'should return E_BAD_ARGS for invalid limit');
    }
    assert(errorThrown, 'should throw error for invalid limit type');

    // 测试无效的 path 类型
    errorThrown = false;
    try {
      await tools.listSnapshots({ path: 123 as any });
    } catch (err: any) {
      errorThrown = true;
      assertEqual(err.error.code, 'E_BAD_ARGS', 'should return E_BAD_ARGS for invalid path');
    }
    assert(errorThrown, 'should throw error for invalid path type');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('restoreSnapshot: should validate snapshotId', async () => {
  const projectRoot = await createTestProject();

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
      },
    });

    // 测试空 snapshotId
    let errorThrown = false;
    try {
      await tools.restoreSnapshot({ snapshotId: '' });
    } catch (err: any) {
      errorThrown = true;
      assertEqual(err.error.code, 'E_BAD_ARGS', 'should return E_BAD_ARGS for empty snapshotId');
    }
    assert(errorThrown, 'should throw error for empty snapshotId');

    // 测试无效格式的 snapshotId
    errorThrown = false;
    try {
      await tools.restoreSnapshot({ snapshotId: 'invalid-format' });
    } catch (err: any) {
      errorThrown = true;
      assertEqual(err.error.code, 'E_BAD_ARGS', 'should return E_BAD_ARGS for invalid format');
    }
    assert(errorThrown, 'should throw error for invalid snapshotId format');

    // 测试不存在的 snapshotId（格式正确）
    errorThrown = false;
    try {
      await tools.restoreSnapshot({ snapshotId: 'snap_20231201T120000_abcd1234' });
    } catch (err: any) {
      errorThrown = true;
      assertEqual(err.error.code, 'E_NOT_FOUND', 'should return E_NOT_FOUND for non-existent snapshot');
    }
    assert(errorThrown, 'should throw error for non-existent snapshot');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 测试 10: get_runtime_info - 返回运行时信息
runner.test('get_runtime_info: should return runtime configuration', async () => {
  const projectRoot = await createTestProject();

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: {
        ...DEFAULT_SANDBOX_CONFIG,
        projectRoot,
        forbiddenDirs: ['node_modules', '.git'],
        maxReadBytes: 5242880,
        textEncoding: 'utf-8',
      },
      snapshotRetention: 20,
    });

    // 注意：get_runtime_info 在 MCP 层实现，这里测试工具层配置是否正确传递
    // 实际的 get_runtime_info 测试应在 MCP 集成测试中进行

    // 验证工具实例化时的配置
    const config = (tools as any).config;
    assertEqual(config.projectRoot, projectRoot, 'projectRoot should match');
    assertEqual(config.snapshotRetention, 20, 'snapshotRetention should be 20');
    assertEqual(config.sandbox.forbiddenDirs.length, 2, 'should have 2 forbidden dirs');
    assertEqual(config.sandbox.maxReadBytes, 5242880, 'maxReadBytes should be 5MB');
    assertEqual(config.sandbox.textEncoding, 'utf-8', 'textEncoding should be utf-8');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// 运行所有测试
runner.run().catch(console.error);

