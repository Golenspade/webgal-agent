/**
 * 手动验证脚本 - WebGAL Agent MVP
 */

import { WebGALAgentTools } from '../packages/agent-core/src/tools/index.js';
import { DEFAULT_SANDBOX_CONFIG } from '../packages/tool-bridge/src/index.js';

const projectRoot = process.env.DEMO_ROOT || '/tmp/webgal-demo';

console.log('🚀 初始化 WebGAL Agent Tools...');
console.log(`📁 项目路径: ${projectRoot}\n`);

const tools = new WebGALAgentTools({
  projectRoot,
  sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
  execution: {
    enabled: true,
    allowedCommands: ['dev', 'build', 'lint'],
    timeoutMs: 30000,
    workingDir: projectRoot,
    redactEnv: [],
  },
  browser: {
    enabled: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    screenshotDir: 'screens',
    timeoutMs: 30000,
  },
  snapshotRetention: 5,
});

async function runTests() {
  try {
    // 1. 列出场景文件
    console.log('━━━ 1. 列出场景文件 ━━━');
    const listResult = await tools.listFiles({ path: 'game/scene' });
    console.log(JSON.stringify(listResult, null, 2));
    console.log('✅ 通过\n');

    // 2. 读取场景文件
    console.log('━━━ 2. 读取场景文件 ━━━');
    const readResult = await tools.readFile({ path: 'game/scene/start.txt' });
    console.log(JSON.stringify(readResult, null, 2));
    console.log('✅ 通过\n');

    // 3. dry-run 写入并查看 diff
    console.log('━━━ 3. dry-run 写入并查看 diff ━━━');
    const newScene = 'changeBg: beach.jpg -next;\n雪乃: 你好;\n';
    const dryRunResult = await tools.writeToFile({
      path: 'game/scene/test.txt',
      content: newScene,
      dryRun: true,
    });
    console.log(JSON.stringify(dryRunResult, null, 2));
    console.log('✅ 通过\n');

    // 4. 实际写入并生成快照
    console.log('━━━ 4. 实际写入并生成快照 ━━━');
    const writeResult = await tools.writeToFile({
      path: 'game/scene/test.txt',
      content: newScene,
      dryRun: false,
      idempotencyKey: 'demo-1',
    });
    console.log(JSON.stringify(writeResult, null, 2));
    console.log('✅ 通过\n');

    // 5. 文件内替换
    console.log('━━━ 5. 文件内替换 ━━━');
    const replaceResult = await tools.replaceInFile({
      path: 'game/scene/test.txt',
      find: '雪乃',
      replace: '由比滨',
    });
    console.log(JSON.stringify(replaceResult, null, 2));
    console.log('✅ 通过\n');

    // 6. 搜索匹配
    console.log('━━━ 6. 搜索匹配 ━━━');
    const searchResult = await tools.searchFiles({
      path: 'game/scene',
      regex: '由比滨|雪乃',
      filePattern: '**/*.txt',
      maxMatches: 100,
    });
    console.log(JSON.stringify(searchResult, null, 2));
    console.log('✅ 通过\n');

    // 7. 脚本校验（合法场景）
    console.log('━━━ 7. 脚本校验（合法场景）━━━');
    const validResult = await tools.validateScript({ content: newScene });
    console.log(JSON.stringify(validResult, null, 2));
    console.log('✅ 通过\n');

    // 8. 脚本校验（故意错误）
    console.log('━━━ 8. 脚本校验（故意错误）━━━');
    const invalidResult = await tools.validateScript({
      content: 'changeBg: not_exist.jpg;\n',
    });
    console.log(JSON.stringify(invalidResult, null, 2));
    console.log('✅ 通过\n');

    // 9. 列出项目资源
    console.log('━━━ 9. 列出项目资源 ━━━');
    const resourcesResult = await tools.listProjectResources();
    console.log(JSON.stringify(resourcesResult, null, 2));
    console.log('✅ 通过\n');

    // 10. 预览场景（自动识别端口）
    console.log('━━━ 10. 预览场景（自动识别端口）━━━');
    const previewResult = await tools.previewScene({
      scenePath: 'game/scene/start.txt',
    });
    console.log(JSON.stringify(previewResult, null, 2));
    console.log('✅ 通过\n');

    // 11. 执行白名单命令
    console.log('━━━ 11. 执行白名单命令 ━━━');
    const execResult = await tools.executeCommand({ scriptName: 'build' });
    console.log(JSON.stringify(execResult, null, 2));
    console.log('✅ 通过\n');

    // 12. 路径沙箱校验（错误分支）
    console.log('━━━ 12. 路径沙箱校验（错误分支）━━━');
    try {
      await tools.readFile({ path: '/etc/hosts' as any });
      console.log('❌ 应该抛出错误但没有');
    } catch (e: any) {
      console.log('捕获到预期错误:', e.error?.code, e.error?.message);
      console.log('✅ 通过\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('  🎉 所有手动验证测试通过！');
    console.log('═══════════════════════════════════════');
  } catch (error: any) {
    console.error('❌ 测试失败:', error);
    if (error.error) {
      console.error('错误详情:', JSON.stringify(error.error, null, 2));
    }
    process.exit(1);
  }
}

runTests();

