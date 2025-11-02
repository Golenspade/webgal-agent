/**
 * 测试 MCP 服务器
 * 
 * 通过 stdio 与 MCP 服务器通信，验证工具调用
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = '/tmp/webgal-demo';
const mcpBin = resolve(__dirname, '../packages/mcp-webgal/src/bin.ts');

console.log('🚀 启动 MCP 服务器...');
console.log(`📁 项目路径: ${projectRoot}\n`);

const server = spawn('tsx', [mcpBin, '--project', projectRoot], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let responseBuffer = '';
let requestId = 1;

// 监听服务器响应
server.stdout.on('data', (data) => {
  responseBuffer += data.toString();
  
  // 尝试解析完整的 JSON-RPC 消息
  const lines = responseBuffer.split('\n');
  responseBuffer = lines.pop() || ''; // 保留不完整的行
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const message = JSON.parse(line);
        console.log('📥 收到响应:', JSON.stringify(message, null, 2));
      } catch (e) {
        console.log('📥 原始输出:', line);
      }
    }
  }
});

server.on('error', (error) => {
  console.error('❌ 服务器错误:', error);
  process.exit(1);
});

server.on('exit', (code) => {
  console.log(`\n服务器退出，代码: ${code}`);
  process.exit(code || 0);
});

// 发送 JSON-RPC 请求
function sendRequest(method: string, params: any = {}) {
  const request = {
    jsonrpc: '2.0',
    id: requestId++,
    method,
    params,
  };
  
  console.log('📤 发送请求:', JSON.stringify(request, null, 2));
  server.stdin.write(JSON.stringify(request) + '\n');
}

// 等待服务器启动
setTimeout(() => {
  console.log('\n━━━ 测试 1: 初始化 ━━━');
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0',
    },
  });
}, 1000);

setTimeout(() => {
  console.log('\n━━━ 测试 2: 列出工具 ━━━');
  sendRequest('tools/list');
}, 2000);

setTimeout(() => {
  console.log('\n━━━ 测试 3: 调用 list_files ━━━');
  sendRequest('tools/call', {
    name: 'list_files',
    arguments: {
      path: 'game/scene',
    },
  });
}, 3000);

setTimeout(() => {
  console.log('\n━━━ 测试 4: 调用 read_file ━━━');
  sendRequest('tools/call', {
    name: 'read_file',
    arguments: {
      path: 'game/scene/start.txt',
    },
  });
}, 4000);

setTimeout(() => {
  console.log('\n━━━ 测试 5: 调用 validate_script ━━━');
  sendRequest('tools/call', {
    name: 'validate_script',
    arguments: {
      content: 'changeBg: beach.jpg;\n雪乃: 你好;',
    },
  });
}, 5000);

// 6 秒后关闭
setTimeout(() => {
  console.log('\n✅ 测试完成，关闭服务器...');
  server.kill();
}, 6000);

