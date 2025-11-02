#!/usr/bin/env node
/**
 * MCP WebGAL CLI
 * 
 * 用法:
 *   mcp-webgal --project <path> [--policies <file>] [--retention <num>]
 */

import { startServer } from './server.js';
import { resolve } from 'path';
import { existsSync } from 'fs';

interface CLIArgs {
  project?: string;
  policies?: string;
  retention?: number;
  help?: boolean;
}

function parseArgs(): CLIArgs {
  const args: CLIArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--project' || arg === '-p') {
      args.project = argv[++i];
    } else if (arg === '--policies') {
      args.policies = argv[++i];
    } else if (arg === '--retention') {
      args.retention = parseInt(argv[++i], 10);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
WebGAL Agent MCP Server

用法:
  mcp-webgal --project <path> [选项]

选项:
  --project, -p <path>    WebGAL 项目根目录（必需）
  --policies <file>       策略配置文件路径（可选）
  --retention <num>       快照保留数量（默认: 20）
  --help, -h              显示帮助信息

示例:
  mcp-webgal --project /path/to/webgal-project
  mcp-webgal -p ./my-game --policies ./custom-policies.json --retention 10
`);
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.project) {
    console.error('错误: 缺少 --project 参数');
    printHelp();
    process.exit(1);
  }

  const projectRoot = resolve(args.project);

  if (!existsSync(projectRoot)) {
    console.error(`错误: 项目目录不存在: ${projectRoot}`);
    process.exit(1);
  }

  // TODO: 加载 policies 文件（阶段 2）
  if (args.policies) {
    console.error(`警告: --policies 参数暂未实现，将使用默认策略`);
  }

  try {
    await startServer({
      projectRoot,
      policiesPath: args.policies,
      snapshotRetention: args.retention,
    });
  } catch (error: any) {
    console.error('启动服务器失败:', error.message);
    process.exit(1);
  }
}

main();

