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
import { loadResolvedConfig, resolvePoliciesPath, parseListFlag, type CliOverrides } from './config.js';
import { acquireLock, registerLockCleanup, checkLock } from './lock-manager.js';

interface CLIArgs extends CliOverrides {
  project?: string;
  policies?: string;
  help?: boolean;
  verbose?: boolean;
  version?: boolean;
  health?: boolean;
  // 启用开关
  enableExec?: boolean;
  enableBrowser?: boolean;
  // Sandbox 覆盖
  sandboxForbidden?: string;
  sandboxMaxBytes?: number;
  sandboxEncoding?: string;
  // Execution 覆盖
  execAllowed?: string;
  execTimeout?: number;
  execRedactEnv?: string;
  execWorkdir?: string;
  // Browser 覆盖
  browserAllowedHosts?: string;
  browserTimeout?: number;
  browserScreenshotDir?: string;
}

function parseArgs(): CLIArgs {
  const args: CLIArgs = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      args.version = true;
    } else if (arg === '--health') {
      args.health = true;
    } else if (arg === '--project' || arg === '-p') {
      args.project = argv[++i];
    } else if (arg === '--policies') {
      args.policies = argv[++i];
    } else if (arg === '--retention') {
      args.snapshotRetention = parseInt(argv[++i], 10);
    } else if (arg === '--enable-exec') {
      args.enableExec = true;
    } else if (arg === '--enable-browser') {
      args.enableBrowser = true;
    } else if (arg === '--verbose') {
      args.verbose = true;
    }
    // Sandbox 覆盖
    else if (arg === '--sandbox-forbidden') {
      args.sandboxForbidden = argv[++i];
    } else if (arg === '--sandbox-max-bytes') {
      args.sandboxMaxBytes = parseInt(argv[++i], 10);
    } else if (arg === '--sandbox-encoding') {
      args.sandboxEncoding = argv[++i];
    }
    // Execution 覆盖
    else if (arg === '--exec-allowed') {
      args.execAllowed = argv[++i];
    } else if (arg === '--exec-timeout') {
      args.execTimeout = parseInt(argv[++i], 10);
    } else if (arg === '--exec-redact-env') {
      args.execRedactEnv = argv[++i];
    } else if (arg === '--exec-workdir') {
      args.execWorkdir = argv[++i];
    }
    // Browser 覆盖
    else if (arg === '--browser-allowed-hosts') {
      args.browserAllowedHosts = argv[++i];
    } else if (arg === '--browser-timeout') {
      args.browserTimeout = parseInt(argv[++i], 10);
    } else if (arg === '--browser-screenshot-dir') {
      args.browserScreenshotDir = argv[++i];
    }
  }

  return args;
}

function printHelp() {
  console.log(`
webgal-agent-mcpserver (WebGAL MCP Server)

用法:
  webgal-agent-mcpserver --project <path> [选项]
  或兼容命令：mcp-webgal --project <path> [选项]

必填:
  --project, -p <path>              WebGAL 项目根目录

启用开关:
  --enable-exec                     启用命令执行（白名单脚本）
  --enable-browser                  启用浏览器动作（URL 校验）

配置:
  --policies <file>                 策略配置文件路径
  --retention <num>                 快照保留数量（默认: 20）
  --verbose                         输出调试日志（启动参数、policiesPath、幂等配置、锁信息、tools 数）

Sandbox 覆盖:
  --sandbox-forbidden <dirs>        禁止目录（逗号分隔，默认: .git,node_modules,.env,.webgal_agent）
  --sandbox-max-bytes <num>         最大读取字节数（默认: 1048576）
  --sandbox-encoding <enc>          文本编码（默认: utf-8）

Execution 覆盖（需 --enable-exec）:
  --exec-allowed <cmds>             白名单脚本（逗号分隔，默认从 package.json 收集）
  --exec-timeout <ms>               超时毫秒数（默认: 60000）
  --exec-redact-env <keys>          遮蔽环境变量（逗号分隔，默认: API_KEY,TOKEN,SECRET）
  --exec-workdir <path>             执行工作目录（默认: 项目根）

Browser 覆盖（需 --enable-browser）:
  --browser-allowed-hosts <hosts>   允许主机（逗号分隔，默认: localhost,127.0.0.1）
  --browser-timeout <ms>            超时毫秒数（默认: 30000）
  --browser-screenshot-dir <path>   截图目录（默认: .webgal_agent/screenshots）

 其他:
  --help, -h                        显示帮助信息
  --version, -v                     显示版本并退出
  --health                          健康检查（输出 JSON；与 --project/环境变量配合）

示例:
  # 最小启动（仅文件工具）
  webgal-agent-mcpserver --project /path/to/webgal-project

  # 启用执行（自动收集 package.json 脚本）
  webgal-agent-mcpserver --project . --enable-exec

  # 自定义策略 + 覆盖部分项
  webgal-agent-mcpserver -p . --policies ./configs/policies.json --enable-exec --exec-timeout 120000

  # 完整自定义
  webgal-agent-mcpserver -p . --enable-exec --enable-browser \\
    --sandbox-forbidden ".git,node_modules,.env,.webgal_agent,dist" \\
    --exec-allowed "dev,build,lint,test" \\
    --browser-allowed-hosts "localhost,127.0.0.1,0.0.0.0"
`);
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // 版本查询
  if (args.version) {
  console.log('webgal-agent-mcpserver v0.1.0');
  process.exit(0);
}

  // 支持从环境变量读取项目根
  const envProject = process.env.WEBGAL_AGENT_PROJECT || process.env.WEBGAL_PROJECT_ROOT;
  const projectArg = args.project || envProject;
  if (!projectArg && !args.health) {
    console.error('错误: 缺少 --project 参数');
    printHelp();
    process.exit(1);
  }

  const projectRoot = resolve(projectArg || process.cwd());

  if (!existsSync(projectRoot)) {
    console.error(`错误: 项目目录不存在: ${projectRoot}`);
    if (args.health) {
      console.log(JSON.stringify({ healthy: false, reason: 'PROJECT_ROOT_NOT_FOUND', projectRoot, version: '0.1.0' }));
      process.exit(1);
    } else {
      process.exit(1);
    }
  }

  // 解析策略文件路径
  const policiesPath = resolvePoliciesPath(args.policies, projectRoot);

  // 健康检查：不启动服务器，仅输出状态
  if (args.health) {
    try {
      const lock = await checkLock(projectRoot);
      const healthy = !!existsSync(projectRoot) && !lock;
      const payload: any = {
        healthy,
        version: '0.1.0',
        projectRoot,
        ...(policiesPath && { policiesPath }),
        lock,
      };
      console.log(JSON.stringify(payload));
      process.exit(healthy ? 0 : 2);
    } catch (err: any) {
      console.log(JSON.stringify({ healthy: false, error: err?.message || String(err), version: '0.1.0' }));
      process.exit(2);
    }
  }

  // 构造 CLI 覆盖
  const cliOverrides: CliOverrides = {
    snapshotRetention: args.snapshotRetention,
    sandbox: {
      forbiddenDirs: args.sandboxForbidden ? parseListFlag(args.sandboxForbidden) : undefined,
      maxReadBytes: args.sandboxMaxBytes,
      textEncoding: args.sandboxEncoding,
    },
    execution: {
      enabled: args.enableExec,
      allowedCommands: args.execAllowed ? parseListFlag(args.execAllowed) : undefined,
      timeoutMs: args.execTimeout,
      workingDir: args.execWorkdir,
      redactEnv: args.execRedactEnv ? parseListFlag(args.execRedactEnv) : undefined,
    },
    browser: {
      enabled: args.enableBrowser,
      allowedHosts: args.browserAllowedHosts ? parseListFlag(args.browserAllowedHosts) : undefined,
      timeoutMs: args.browserTimeout,
      screenshotDir: args.browserScreenshotDir,
    },
  };

  try {
    // 获取锁（确保单实例）
    await acquireLock(projectRoot, 'manual', '0.1.0');
    registerLockCleanup(projectRoot);

    // 加载并合并配置
    const resolved = await loadResolvedConfig(projectRoot, cliOverrides, policiesPath);

    // 统一日志前缀 + 观测性
    if (args.verbose) {
      console.error(`[MCP] argv: ${process.argv.slice(2).join(' ')}`);
      if (policiesPath) console.error(`[POLICY] policiesPath: ${policiesPath}`);
      console.error(`[POLICY] idempotency: ${JSON.stringify(resolved.idempotency)}`);
      const lock = await checkLock(projectRoot);
      if (lock) console.error(`[LOCK] ${JSON.stringify(lock)}`);
    }

    // 普通模式的关键信息
    console.error(`[MCP] projectRoot: ${projectRoot}`);
    console.error(`[MCP] snapshotRetention: ${resolved.snapshotRetention}`);
    console.error(`[MCP] execution: ${resolved.execution ? 'enabled' : 'disabled'}`);
    console.error(`[MCP] browser: ${resolved.browser ? 'enabled' : 'disabled'}`);
    console.error(`[LOCK] acquired (pid: ${process.pid})`);

    await startServer({
      projectRoot,
      policiesPath,
      verbose: !!args.verbose,
      ...resolved,
    });
  } catch (error: any) {
    if ((error as any).code === 'E_LOCK_HELD') {
      console.error('[LOCK] E_LOCK_HELD:', error.message);
      process.exit(2);
    }
    console.error('[MCP] start failed:', error.message);
    process.exit(1);
  }
}

main();
