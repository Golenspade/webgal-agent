/**
 * 测试配置加载与合并
 */

import { loadResolvedConfig, resolvePoliciesPath, parseListFlag } from '../packages/mcp-webgal/src/config.js';

const projectRoot = '/tmp/webgal-demo';

async function main() {

console.log('━━━ 测试 1: 解析列表标志 ━━━');
console.log('parseListFlag("a,b,c"):', parseListFlag('a,b,c'));
console.log('parseListFlag(" a , b , c "):', parseListFlag(' a , b , c '));
console.log('parseListFlag(""):', parseListFlag(''));
console.log('parseListFlag(undefined):', parseListFlag(undefined));

console.log('\n━━━ 测试 2: 解析策略文件路径 ━━━');
const policiesPath = resolvePoliciesPath(undefined, process.cwd());
console.log('策略文件路径:', policiesPath || '未找到');

console.log('\n━━━ 测试 3: 加载默认配置（无启用）━━━');
const config1 = await loadResolvedConfig(projectRoot, {});
console.log('快照保留:', config1.snapshotRetention);
console.log('禁止目录:', config1.sandbox.forbiddenDirs);
console.log('执行能力:', config1.execution ? '启用' : '禁用');
console.log('浏览器能力:', config1.browser ? '启用' : '禁用');

console.log('\n━━━ 测试 4: 启用执行（动态收集脚本）━━━');
const config2 = await loadResolvedConfig(projectRoot, {
  execution: { enabled: true },
});
console.log('执行能力:', config2.execution ? '启用' : '禁用');
if (config2.execution) {
  console.log('白名单脚本:', config2.execution.allowedCommands);
  console.log('超时:', config2.execution.timeoutMs);
}

console.log('\n━━━ 测试 5: CLI 覆盖 ━━━');
const config3 = await loadResolvedConfig(projectRoot, {
  snapshotRetention: 50,
  sandbox: {
    forbiddenDirs: parseListFlag('.git,node_modules,dist'),
    maxReadBytes: 2097152,
  },
  execution: {
    enabled: true,
    allowedCommands: parseListFlag('dev,build,test'),
    timeoutMs: 120000,
  },
  browser: {
    enabled: true,
    allowedHosts: parseListFlag('localhost,127.0.0.1,0.0.0.0'),
  },
});
console.log('快照保留:', config3.snapshotRetention);
console.log('禁止目录:', config3.sandbox.forbiddenDirs);
console.log('最大字节:', config3.sandbox.maxReadBytes);
console.log('执行白名单:', config3.execution?.allowedCommands);
console.log('执行超时:', config3.execution?.timeoutMs);
console.log('浏览器主机:', config3.browser?.allowedHosts);

console.log('\n━━━ 测试 6: 加载策略文件 ━━━');
if (policiesPath) {
  const config4 = await loadResolvedConfig(projectRoot, {}, policiesPath);
  console.log('快照保留:', config4.snapshotRetention);
  console.log('执行能力:', config4.execution ? '启用' : '禁用');
  if (config4.execution) {
    console.log('白名单脚本:', config4.execution.allowedCommands);
  }
}

console.log('\n✅ 配置测试完成');
}

main();

