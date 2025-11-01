/**
 * 文件系统工具测试
 */

import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import { DEFAULT_SANDBOX_CONFIG } from '@webgal-agent/tool-bridge';
import {
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  assertOnlyKeys,
  expectToolError,
  createLargeFile,
  mutateFile,
  TestRunner,
} from './test-utils.js';

const runner = new TestRunner();

// list_files 测试
runner.test('list_files: should list directory', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.listFiles({ path: 'game/scene' });

    assertOnlyKeys(result, ['entries'], 'list_files response');
    assert(Array.isArray(result.entries), 'entries should be array');
    assert(result.entries.includes('start.txt'), 'should include start.txt');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('list_files: should support globs', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.listFiles({
      path: 'game',
      globs: ['**/*.txt'],
    });

    assert(result.entries.some(f => f.endsWith('.txt')), 'should only include .txt files');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('list_files: should return E_NOT_FOUND for missing directory', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    await expectToolError(
      tools.listFiles({ path: 'nonexistent' }),
      'E_NOT_FOUND'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// read_file 测试
runner.test('read_file: should read file content', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.readFile({ path: 'game/scene/start.txt' });
    
    assertOnlyKeys(result, ['path', 'content', 'encoding', 'bytes'], 'read_file response');
    assertEqual(result.path, 'game/scene/start.txt');
    assertEqual(result.encoding, 'utf-8');
    assert(result.bytes > 0, 'bytes should be > 0');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('read_file: should respect maxBytes limit', async () => {
  const projectRoot = await createTestProject();
  
  try {
    await createLargeFile(projectRoot, 'large.txt', 2000);
    
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    await expectToolError(
      tools.readFile({ path: 'large.txt', maxBytes: 1000 }),
      'E_TOO_LARGE'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('read_file: should return E_NOT_FOUND for missing file', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    await expectToolError(
      tools.readFile({ path: 'nonexistent.txt' }),
      'E_NOT_FOUND'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// write_to_file 测试
runner.test('write_to_file: dryRun should return diff', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.writeToFile({
      path: 'test.txt',
      content: 'new content',
      dryRun: true,
    });

    assertOnlyKeys(result, ['applied', 'diff'], 'write_to_file dryRun response');
    assertEqual(result.applied, false);
    assert(result.diff !== undefined, 'should have diff');
    assert(result.diff!.hunks.length > 0, 'should have hunks');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('write_to_file: actual write should return snapshotId', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.writeToFile({
      path: 'test.txt',
      content: 'new content',
      dryRun: false,
    });

    assertOnlyKeys(result, ['applied', 'snapshotId', 'bytesWritten'], 'write_to_file actual write response');
    assertEqual(result.applied, true);
    assert(result.snapshotId !== undefined, 'should have snapshotId');
    assert(result.bytesWritten > 0, 'should have bytesWritten');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('write_to_file: idempotency should prevent duplicate writes', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result1 = await tools.writeToFile({
      path: 'test.txt',
      content: 'content',
      dryRun: false,
      idempotencyKey: 'test-key-1',
    });

    const result2 = await tools.writeToFile({
      path: 'test.txt',
      content: 'content',
      dryRun: false,
      idempotencyKey: 'test-key-1',
    });
    
    assertEqual(result1.snapshotId, result2.snapshotId, 'snapshotId should be same');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('write_to_file: should detect concurrent modification', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    // Dry-run
    await tools.writeToFile({
      path: 'test.txt',
      content: 'original',
      dryRun: false,
    });

    await tools.writeToFile({
      path: 'test.txt',
      content: 'modified',
      dryRun: true,
    });

    // 外部修改
    await mutateFile(projectRoot, 'test.txt', 'external change');

    // 实际写入应检测冲突
    await expectToolError(
      tools.writeToFile({
        path: 'test.txt',
        content: 'modified',
        dryRun: false,
      }),
      'E_CONFLICT'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// replace_in_file 测试
runner.test('replace_in_file: should return replacement count', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    await tools.writeToFile({
      path: 'test.txt',
      content: 'foo bar foo baz',
      dryRun: false,
    });

    const result = await tools.replaceInFile({
      path: 'test.txt',
      find: 'foo',
      replace: 'qux',
    });

    assertOnlyKeys(result, ['path', 'count'], 'replace_in_file response');
    assertEqual(result.count, 2, 'should replace 2 occurrences');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('replace_in_file: should handle invalid regex', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    await tools.writeToFile({
      path: 'test.txt',
      content: 'test',
      dryRun: false,
    });

    await expectToolError(
      tools.replaceInFile({
        path: 'test.txt',
        find: '[invalid',
        replace: 'x',
        flags: 'g',
      }),
      'E_BAD_ARGS'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// search_files 测试
runner.test('search_files: should find matches', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.searchFiles({
      path: 'game/scene',
      regex: '雪乃',
      filePattern: '**/*.txt',
    });
    
    assertOnlyKeys(result, ['matches'], 'search_files response');
    assert(Array.isArray(result.matches), 'matches should be array');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

export { runner };

