/**
 * 资源与预览测试
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
  TestRunner,
} from './test-utils.js';

const runner = new TestRunner();

// list_project_resources 测试
runner.test('list_project_resources: should list all resources', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.listProjectResources();

    assertOnlyKeys(result, ['backgrounds', 'figures', 'bgm', 'vocals', 'scenes'], 'list_project_resources response');
    assert(Array.isArray(result.backgrounds), 'backgrounds should be array');
    assert(Array.isArray(result.figures), 'figures should be array');
    assert(Array.isArray(result.bgm), 'bgm should be array');
    assert(Array.isArray(result.vocals), 'vocals should be array');
    assert(Array.isArray(result.scenes), 'scenes should be array');
    
    assert(result.backgrounds.includes('beach.jpg'), 'should include beach.jpg');
    assert(result.figures.includes('yukino.png'), 'should include yukino.png');
    assert(result.bgm.includes('beach_bgm.mp3'), 'should include beach_bgm.mp3');
    assert(result.scenes.includes('start.txt'), 'should include start.txt');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('list_project_resources: should filter by extension', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.listProjectResources();
    
    // 背景应该只包含图片
    assert(result.backgrounds.every(f => /\.(jpg|png|webp)$/i.test(f)), 'backgrounds should be images');
    
    // BGM 应该只包含音频
    assert(result.bgm.every(f => /\.(mp3|ogg|wav)$/i.test(f)), 'bgm should be audio');
    
    // 场景应该只包含 .txt
    assert(result.scenes.every(f => f.endsWith('.txt')), 'scenes should be .txt');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('list_project_resources: should return empty arrays for missing directories', async () => {
  const projectRoot = await createTestProject();
  
  try {
    // 删除某个目录
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.rm(path.join(projectRoot, 'game/vocal'), { recursive: true, force: true });
    
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.listProjectResources();

    assertEqual(result.vocals.length, 0, 'vocals should be empty array');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

// preview_scene 测试
runner.test('preview_scene: should return URL for existing scene', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
      execution: {
        enabled: true,
        allowedCommands: ['dev'],
        timeoutMs: 10000,
        workingDir: projectRoot,
        redactEnv: [],
      },
    });

    const result = await tools.previewScene({
      scenePath: 'game/scene/start.txt',
    });
    
    assertOnlyKeys(result, ['url', 'logs'], 'preview_scene response');
    assert(result.url.includes('localhost'), 'URL should contain localhost');
    assert(result.url.includes('3001'), 'URL should contain port');
    assert(result.url.includes('scene=start'), 'URL should contain scene parameter');
    assert(Array.isArray(result.logs), 'logs should be array');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('preview_scene: should return E_NOT_FOUND for missing scene', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
      execution: {
        enabled: true,
        allowedCommands: ['dev'],
        timeoutMs: 10000,
        workingDir: projectRoot,
        redactEnv: [],
      },
    });

    await expectToolError(
      tools.previewScene({ scenePath: 'game/scene/nonexistent.txt' }),
      'E_NOT_FOUND'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('preview_scene: should return E_TOOL_DISABLED when executor not available', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
      // No execution config
    });

    await expectToolError(
      tools.previewScene({ scenePath: 'game/scene/start.txt' }),
      'E_TOOL_DISABLED'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('preview_scene: should extract port from logs', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
      execution: {
        enabled: true,
        allowedCommands: ['dev'],
        timeoutMs: 10000,
        workingDir: projectRoot,
        redactEnv: [],
      },
    });

    const result = await tools.previewScene({
      scenePath: 'game/scene/start.txt',
    });
    
    // 应该从 "localhost:3001" 提取端口
    assert(result.url.includes(':3001'), 'should extract port 3001');
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('preview_scene: should timeout if no port found', async () => {
  const projectRoot = await createTestProject();

  try {
    // 修改 package.json 使用长时间运行但不输出端口的脚本
    const fs = await import('fs/promises');
    const path = await import('path');
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    pkg.scripts.dev = 'node -e "setInterval(() => console.log(\'tick\'), 500)"';
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
      execution: {
        enabled: true,
        allowedCommands: ['dev'],
        timeoutMs: 10000,
        workingDir: projectRoot,
        redactEnv: [],
      },
    });

    await expectToolError(
      tools.previewScene({ scenePath: 'game/scene/start.txt' }),
      'E_TIMEOUT'
    );
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

export { runner };

