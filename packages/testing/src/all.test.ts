/**
 * 测试入口 - 运行所有测试
 */

import { runner as fsRunner } from './fs.test.js';
import { runner as validatorRunner } from './validator.test.js';
import { runner as bridgeRunner } from './bridge.test.js';
import { runner as resourcesPreviewRunner } from './resources-preview.test.js';
import { runner as diffSnapshotRunner } from './diff-snapshot.test.js';
import { runner as interactRunner } from './interact.test.js';

async function runAllTests() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  WebGAL Agent MVP 测试套件');
  console.log('═══════════════════════════════════════════════════════\n');

  const runners = [
    { name: '文件系统工具', runner: fsRunner },
    { name: '脚本校验', runner: validatorRunner },
    { name: '工具桥（沙箱/命令/浏览器）', runner: bridgeRunner },
    { name: '资源与预览', runner: resourcesPreviewRunner },
    { name: 'Diff 与快照', runner: diffSnapshotRunner },
    { name: '交互工具', runner: interactRunner },
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  for (const { name, runner } of runners) {
    console.log(`\n━━━ ${name} ━━━`);
    await runner.run();
    
    // 累计统计（假设 runner 有 passed/failed 属性）
    const runnerAny = runner as any;
    if (runnerAny.passed !== undefined) {
      totalPassed += runnerAny.passed;
      totalFailed += runnerAny.failed;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  总计: ${totalPassed} 通过, ${totalFailed} 失败`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('测试运行失败:', err);
  process.exit(1);
});

