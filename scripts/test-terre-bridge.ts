/**
 * 测试 Terre Addon 主进程模块
 */

import { getPreviewPort, buildPreviewUrl } from '../apps/terre-addon/src/main/port-resolver.js';
import { McpProcessManager } from '../apps/terre-addon/src/main/mcp-process-manager.js';

const projectRoot = '/tmp/webgal-demo';

async function main() {
  console.log('━━━ 测试 1: 端口解析 ━━━');
  
  // 测试默认端口
  delete process.env.WEBGAL_PORT;
  console.log('默认端口:', getPreviewPort()); // 应该是 3001
  
  // 测试自定义端口
  process.env.WEBGAL_PORT = '3002';
  console.log('自定义端口 (WEBGAL_PORT=3002):', getPreviewPort()); // 应该是 3003
  
  // 测试 URL 构造
  console.log('基础 URL:', buildPreviewUrl());
  console.log('场景 URL:', buildPreviewUrl('game/scene/start.txt'));
  
  // 恢复默认
  delete process.env.WEBGAL_PORT;
  
  console.log('\n━━━ 测试 2: MCP 进程管理器 ━━━');
  
  const manager = new McpProcessManager();
  
  try {
    console.log('启动 MCP 进程...');
    await manager.start(projectRoot, {
      enableExec: false,
      enableBrowser: false,
    });
    
    console.log('✅ MCP 进程已启动');
    
    // 获取状态
    const status = manager.getStatus();
    console.log('状态:', status);
    
    // 列出工具
    console.log('\n列出工具...');
    const tools = await manager.listTools();
    console.log(`✅ 找到 ${tools.length} 个工具:`, tools.map(t => t.name).join(', '));
    
    // 调用工具：列出场景
    console.log('\n调用工具: list_files...');
    const scenes = await manager.callTool('list_files', { path: 'game/scene' });
    console.log('✅ 场景列表:', scenes);
    
    // 调用工具：读取文件
    if (scenes.entries && scenes.entries.length > 0) {
      const firstScene = scenes.entries[0].name;
      console.log(`\n调用工具: read_file (${firstScene})...`);
      const content = await manager.callTool('read_file', { path: `game/scene/${firstScene}` });
      console.log('✅ 文件内容长度:', content.content?.length || 0);
    }
    
    // 停止进程
    console.log('\n停止 MCP 进程...');
    await manager.stop();
    console.log('✅ MCP 进程已停止');
    
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    await manager.stop();
    process.exit(1);
  }
  
  console.log('\n✅ 所有测试通过');
}

main();

