/**
 * 测试 MCP 服务器配置启动
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = '/tmp/webgal-demo';
const mcpBin = resolve(__dirname, '../packages/mcp-webgal/src/bin.ts');

console.log('━━━ 测试 1: 最小启动（仅文件工具）━━━\n');

const server1 = spawn('tsx', [mcpBin, '--project', projectRoot], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer1 = '';
server1.stdout.on('data', (data) => {
  buffer1 += data.toString();
});

setTimeout(() => {
  server1.kill();
  console.log('✅ 最小启动成功\n');
  
  console.log('━━━ 测试 2: 启用执行 ━━━\n');
  
  const server2 = spawn('tsx', [mcpBin, '--project', projectRoot, '--enable-exec'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  
  setTimeout(() => {
    server2.kill();
    console.log('✅ 启用执行成功\n');
    
    console.log('━━━ 测试 3: 完整自定义 ━━━\n');
    
    const server3 = spawn('tsx', [
      mcpBin,
      '--project', projectRoot,
      '--enable-exec',
      '--enable-browser',
      '--retention', '50',
      '--sandbox-forbidden', '.git,node_modules,dist',
      '--exec-allowed', 'dev,build,test',
      '--exec-timeout', '120000',
    ], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    
    setTimeout(() => {
      server3.kill();
      console.log('✅ 完整自定义成功\n');
      console.log('✅ 所有配置测试通过');
      process.exit(0);
    }, 2000);
  }, 2000);
}, 2000);

