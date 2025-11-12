# WebGAL Agent MCP Server 架构审计报告

> 基于标准 MCP Server 十层架构的深度对照分析

---

## 📋 审计概览

| 层次 | 标准要求 | 当前实现 | 符合度 | 问题 |
|------|---------|---------|--------|------|
| 1. Bootstrap & Process | ✅ 必需 | ✅ 完整 | 🟢 95% | 缺少 --version/--health |
| 2. Transport Layer | ✅ 必需 | ✅ 完整 | 🟢 100% | 无 |
| 3. Protocol Engine | ✅ 必需 | 🟡 基础 | 🟡 70% | 缺少流式/取消/进度 |
| 4. Capability Registry | ✅ 必需 | 🟡 简化 | 🟡 75% | 缺少 Resources/Prompts |
| 5. Domain Layer | ✅ 必需 | ✅ 完整 | 🟢 90% | 部分工具未实现 |
| 6. State & Storage | ✅ 必需 | ✅ 完整 | 🟢 85% | 缺少密钥管理 |
| 7. Security & Sandbox | ✅ 必需 | ✅ 完整 | 🟢 95% | 符号链接检查待加强 |
| 8. Observability | ⚠️ 推荐 | 🟡 基础 | 🟡 60% | 缺少指标/追踪 |
| 9. Errors & Reliability | ✅ 必需 | ✅ 完整 | 🟢 90% | 超时/取消待完善 |
| 10. Lifecycle | ✅ 必需 | ✅ 完整 | 🟢 90% | 缺少 Heartbeat |

**总体评分**: 🟢 **85/100** - 良好，核心功能完整，部分高级特性待补充

---

## 🔍 分层详细分析

### 1️⃣ Bootstrap & Process Layer（进程启动层）

#### 标准要求
- ✅ 解析 CLI/env 配置
- ✅ 设置编码
- ⚠️ 打印 --version/--health
- ✅ 注册 SIGINT/SIGTERM 优雅退出
- ✅ 单一职责：拉起传输层 + 协议引擎

#### 当前实现
**文件**: `packages/mcp-webgal/src/bin.ts`

```typescript
// ✅ CLI 参数解析（完整）
function parseArgs(): CLIArgs {
  // 支持 --project, --policies, --retention, --enable-exec, --enable-browser
  // 支持 Sandbox/Execution/Browser 覆盖参数
}

// ✅ 帮助信息
function printHelp() { ... }

// ✅ 主流程
async function main() {
  // 1. 解析参数
  // 2. 验证项目根
  // 3. 获取锁（单实例保证）
  // 4. 加载配置
  // 5. 启动服务器
}

// ✅ 优雅退出（lock-manager.ts）
export function registerLockCleanup(projectRoot: string): void {
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (error) => { cleanup(); process.exit(1); });
}
```

#### ✅ 优点
1. **完整的 CLI 参数系统**：支持 20+ 参数，覆盖所有配置项
2. **优雅退出机制**：SIGINT/SIGTERM/uncaughtException 全覆盖
3. **单实例保证**：通过 `.webgal_agent/agent.lock` 防止并发
4. **详细的帮助信息**：包含示例和说明

#### ⚠️ 缺失
1. **--version 标志**：未实现版本查询
2. **--health 探测**：未提供健康检查端点
3. **环境变量支持**：仅支持 CLI，未读取 `WEBGAL_AGENT_*` 环境变量

#### 🔧 建议改进
```typescript
// 添加版本和健康检查
if (args.version) {
  console.log('webgal-agent v0.1.0');
  process.exit(0);
}

if (args.health) {
  // 快速检查：项目根存在、锁可获取
  const healthy = existsSync(projectRoot) && !(await checkLock(projectRoot));
  console.log(JSON.stringify({ healthy, version: '0.1.0' }));
  process.exit(healthy ? 0 : 1);
}

// 支持环境变量
const projectRoot = args.project || process.env.WEBGAL_AGENT_PROJECT;
```

---

### 2️⃣ Transport Layer（传输层）

#### 标准要求
- ✅ 一行一消息：JSON.stringify(msg) + "\n"
- ✅ 严禁日志写到 stdout
- ✅ 处理背压/大消息
- ✅ 连接生命周期管理

#### 当前实现
**文件**: `packages/mcp-webgal/src/server.ts`

```typescript
export async function startServer(config: ServerConfig) {
  const server = await createMCPServer(config);
  const transport = new StdioServerTransport(); // ✅ 使用 MCP SDK 标准传输
  await server.connect(transport);
  
  console.error(`[MCP] ready (stdio)`); // ✅ 日志到 stderr
}
```

#### ✅ 优点
1. **使用官方 SDK**：`@modelcontextprotocol/sdk/server/stdio.js` 处理所有传输细节
2. **日志隔离**：所有日志输出到 `stderr`，`stdout` 仅用于 JSON-RPC
3. **自动处理**：背压、分块、编码由 SDK 处理

#### 🟢 评价
**完全符合标准**，无需改进。SDK 已处理所有传输层复杂性。

---

### 3️⃣ Protocol Engine（协议引擎）

#### 标准要求
- ✅ JSON-RPC 路由
- ✅ 会话初始化（initialize）
- ✅ 能力方法（tools.list / tools.call）
- ⚠️ 资源（resources.list / resources.read）
- ⚠️ 提示词（prompts.list / prompts.get）
- ❌ 流式/分步（边算边回）
- ❌ 取消支持（$/cancelRequest）
- ⚠️ 幂等/重试（opId）

#### 当前实现
**文件**: `packages/mcp-webgal/src/server.ts`

```typescript
export async function createMCPServer(config: ServerConfig) {
  const server = new Server(
    { name: 'webgal-agent', version: '0.1.0' },
    { capabilities: { tools: {} } } // ⚠️ 仅声明 tools 能力
  );

  // ✅ 工具列表
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));

  // ✅ 工具调用
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    // ✅ 路由到具体工具
    switch (name) {
      case 'list_files': result = await tools.listFiles(args); break;
      case 'read_file': result = await tools.readFile(args); break;
      // ... 13 个工具
    }
    
    // ✅ 统一返回格式
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });
}
```

#### ✅ 优点
1. **标准 JSON-RPC**：使用 MCP SDK 的请求/响应模式
2. **清晰的路由**：switch-case 映射工具名到处理函数
3. **统一错误处理**：catch 块规范化错误格式

#### ⚠️ 缺失
1. **Resources 能力**：未实现 `resources.list` / `resources.read`
   - 可用于暴露项目资源（背景/立绘/BGM）为 MCP Resources
2. **Prompts 能力**：未实现 `prompts.list` / `prompts.get`
   - 可用于提供 WebGAL 脚本模板
3. **流式响应**：所有工具都是一次性返回，无法边算边回
4. **取消支持**：长时间操作（如 preview_scene）无法取消
5. **操作 ID**：未生成 `opId` 用于追踪和幂等

#### 🔧 建议改进
```typescript
// 1. 添加 Resources 能力
const server = new Server(
  { name: 'webgal-agent', version: '0.1.0' },
  { 
    capabilities: { 
      tools: {},
      resources: {} // ✅ 声明资源能力
    } 
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: 'webgal://backgrounds', name: 'Backgrounds', mimeType: 'application/json' },
    { uri: 'webgal://figures', name: 'Figures', mimeType: 'application/json' },
    { uri: 'webgal://scenes', name: 'Scenes', mimeType: 'application/json' },
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === 'webgal://backgrounds') {
    const resources = await tools.listProjectResources();
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(resources.backgrounds)
      }]
    };
  }
  // ...
});

// 2. 添加操作 ID（用于日志追踪）
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const opId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  console.error(`[MCP] ${opId} ${request.params.name} start`);
  
  try {
    const result = await tools[request.params.name](request.params.arguments);
    console.error(`[MCP] ${opId} ${request.params.name} success`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    console.error(`[MCP] ${opId} ${request.params.name} error:`, error);
    throw error;
  }
});
```

---

### 4️⃣ Capability Registry（能力注册中心）

#### 标准要求
- ✅ Tools Registry（name, description, input_schema, handler）
- ⚠️ Resources Registry（uri, list, read, watch）
- ⚠️ Prompts Registry（name, vars, template, render）
- ✅ 规范化错误
- ✅ 参数校验

#### 当前实现
**文件**: `packages/mcp-webgal/src/server.ts`

```typescript
// ✅ 工具定义（完整的 JSON Schema）
const toolDefinitions: Tool[] = [
  {
    name: 'list_files',
    description: '列出目录中的文件和子目录',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于项目根的路径' },
        globs: { type: 'array', items: { type: 'string' } },
        dirsOnly: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  // ... 13 个工具，每个都有完整的 Schema
];
```

#### ✅ 优点
1. **完整的 Schema 定义**：所有工具都有详细的 `inputSchema`
2. **清晰的描述**：每个参数都有 `description`
3. **必填字段标记**：`required` 数组明确指定

#### ⚠️ 缺失
1. **Resources Registry**：未定义资源列表
2. **Prompts Registry**：未定义提示词模板
3. **输出 Schema**：未定义 `outputSchema`（虽然 MCP 不强制）
4. **超时配置**：未在工具定义中指定 `timeout`
5. **并发控制**：未指定 `concurrency` 限制

#### 🔧 建议改进
```typescript
// 添加输出 Schema（可选，但有助于类型安全）
const toolDefinitions: Tool[] = [
  {
    name: 'list_files',
    description: '列出目录中的文件和子目录',
    inputSchema: { ... },
    // ✅ 添加输出 Schema
    outputSchema: {
      type: 'object',
      properties: {
        entries: { type: 'array', items: { type: 'string' } }
      },
      required: ['entries']
    },
    // ✅ 添加元数据
    metadata: {
      timeout: 5000,
      concurrency: 10,
      category: 'filesystem'
    }
  },
  // ...
];

// 添加 Resources 定义
const resourceDefinitions = [
  {
    uri: 'webgal://backgrounds',
    name: 'Project Backgrounds',
    description: 'All background images in game/background/',
    mimeType: 'application/json'
  },
  // ...
];

// 添加 Prompts 定义
const promptDefinitions = [
  {
    name: 'create_scene',
    description: 'Template for creating a new scene',
    arguments: [
      { name: 'sceneName', description: 'Scene file name', required: true },
      { name: 'characters', description: 'Character names', required: false }
    ]
  }
];
```

---

### 5️⃣ Domain Layer（业务领域实现）

#### 标准要求
- ✅ 纯函数优先
- ✅ 副作用封装在适配器
- ✅ 小而精工具
- ⚠️ 可流式

#### 当前实现
**文件**: `packages/agent-core/src/tools/`

```typescript
// ✅ 清晰的分层
export class WebGALAgentTools {
  private sandbox: FsSandbox;           // ✅ 适配器：文件系统
  private fsTools: FileSystemTools;     // ✅ 领域：文件操作
  private validator: ScriptValidator;   // ✅ 领域：脚本校验
  private webgalTools: WebGALTools;     // ✅ 领域：WebGAL 专用
  private executor?: CommandExecutor;   // ✅ 适配器：命令执行
  private browserController?: BrowserController; // ✅ 适配器：浏览器
}
```

**文件系统工具** (`fs.ts`):
```typescript
export class FileSystemTools {
  // ✅ 小而精：每个方法单一职责
  async listFiles(request: ListFilesRequest): Promise<ListFilesResponse>
  async readFile(request: ReadFileRequest): Promise<ReadFileResponse>
  async writeToFile(request: WriteToFileRequest): Promise<WriteToFileResponse>
  async replaceInFile(request: ReplaceInFileRequest): Promise<ReplaceInFileResponse>
  async searchFiles(request: SearchFilesRequest): Promise<SearchFilesResponse>
  
  // ✅ 副作用封装：通过 sandbox 访问文件系统
  const absolutePath = this.sandbox.validatePath(request.path);
  const content = await fs.readFile(absolutePath, encoding);
}
```

#### ✅ 优点
1. **清晰的分层**：Sandbox → Tools → MCP Server
2. **单一职责**：每个工具类专注一个领域
3. **副作用隔离**：所有 IO 通过 `FsSandbox` / `CommandExecutor` 等适配器
4. **类型安全**：完整的 TypeScript 类型定义

#### ⚠️ 缺失
1. **流式支持**：所有工具都是一次性返回，无法处理大文件/长任务
2. **进度回调**：长时间操作（如 `search_files`）无法报告进度

#### 🔧 建议改进
```typescript
// 添加流式接口（可选）
async *searchFilesStream(request: SearchFilesRequest): AsyncGenerator<SearchMatch> {
  const files = await this.listFiles({ path: request.path, globs: [request.filePattern] });
  
  for (const file of files.entries) {
    const content = await this.readFile({ path: file });
    const matches = this.findMatches(content, request.regex);
    
    for (const match of matches) {
      yield match; // ✅ 边找边返回
    }
  }
}
```

---

### 6️⃣ State & Storage（状态与存储）

#### 标准要求
- ✅ 会话状态
- ✅ 缓存
- ✅ 配置（CLI > 环境变量 > 文件）
- ⚠️ 密钥/令牌管理

#### 当前实现
**配置系统** (`config.ts`):
```typescript
// ✅ 三层优先级
export async function loadResolvedConfig(
  projectRoot: string,
  cli: CliOverrides,        // ✅ 最高优先级
  policiesPath?: string     // ✅ 中等优先级
): Promise<ResolvedConfig> {
  const policies = await tryLoadJson<PolicyFile>(policiesPath);
  const defaults = { ... };  // ✅ 最低优先级
  
  return mergeConfig({ defaults, policies, cli });
}
```

**快照系统** (`diff-snapshot.ts`):
```typescript
export class SnapshotManager {
  private snapshotDir: string;
  private retention: number;
  private idempotencyStore: Map<string, string>; // ✅ 幂等性缓存
  
  async createSnapshot(path: string, content: string, idempotencyKey?: string)
  async listSnapshots(limit?: number, pathFilter?: string)
  async restoreSnapshot(snapshotId: string)
  private async cleanupOldSnapshots() // ✅ 自动清理
}
```

**锁管理** (`lock-manager.ts`):
```typescript
export interface AgentLock {
  owner: LockOwner;
  pid: number;
  host: string;
  startedAt: number;
  version: string;
}

// ✅ 单实例保证
export async function acquireLock(projectRoot: string, owner: LockOwner)
export async function checkLock(projectRoot: string): Promise<AgentLock | null>
export async function releaseLock(projectRoot: string)
```

#### ✅ 优点
1. **完整的配置系统**：CLI > policies.json > defaults
2. **快照管理**：自动创建、保留策略、幂等性支持
3. **锁机制**：防止并发实例，支持进程检测
4. **自动清理**：快照超过保留数量自动删除

#### ⚠️ 缺失
1. **密钥管理**：未实现系统钥匙串集成（如 macOS Keychain）
2. **环境变量**：未读取 `WEBGAL_AGENT_*` 环境变量
3. **Schema 缓存**：未缓存编译后的 JSON Schema（Ajv）

#### 🔧 建议改进
```typescript
// 1. 添加环境变量支持
const projectRoot = args.project 
  || process.env.WEBGAL_AGENT_PROJECT 
  || process.cwd();

// 2. 添加密钥管理（可选，使用 keytar）
import * as keytar from 'keytar';

async function getApiKey(): Promise<string | null> {
  return await keytar.getPassword('webgal-agent', 'llm-api-key');
}

async function setApiKey(key: string): Promise<void> {
  await keytar.setPassword('webgal-agent', 'llm-api-key', key);
}
```

---

### 7️⃣ Security & Sandbox（安全与隔离）

#### 标准要求
- ✅ 最小权限
- ✅ 路径归一化与越权检查
- ✅ 进程执行白名单
- ✅ 输入验证

#### 当前实现
**文件沙箱** (`fs-sandbox.ts`):
```typescript
export class FsSandbox {
  validatePath(relativePath: string): string {
    // ✅ 禁止绝对路径
    if (path.isAbsolute(relativePath)) {
      throw this.createError(ErrorCode.E_DENY_PATH, ...);
    }
    
    // ✅ 规范化路径
    const absolutePath = path.resolve(this.config.projectRoot, relativePath);
    const normalizedPath = path.normalize(absolutePath);
    
    // ✅ 检查是否在项目根内
    if (!normalizedPath.startsWith(this.config.projectRoot + path.sep)) {
      throw this.createError(ErrorCode.E_DENY_PATH, 'Path escapes project root');
    }
    
    // ✅ 检查禁止目录
    for (const forbidden of this.config.forbiddenDirs) {
      if (normalizedPath.includes(path.sep + forbidden + path.sep)) {
        throw this.createError(ErrorCode.E_DENY_PATH, `Access to ${forbidden} is forbidden`);
      }
    }
    
    return normalizedPath;
  }
}
```

**命令执行白名单** (`exec-whitelist.ts`):
```typescript
export class CommandExecutor {
  async execute(request: ExecuteCommandRequest): Promise<ExecuteCommandResponse> {
    // ✅ 白名单检查
    if (!this.config.allowedCommands.includes(request.scriptName)) {
      throw { error: { code: ErrorCode.E_POLICY_VIOLATION, ... } };
    }
    
    // ✅ 超时控制
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, this.config.timeoutMs);
    
    // ✅ 环境变量遮蔽
    const env = { ...process.env };
    for (const key of this.config.redactEnv) {
      delete env[key];
    }
  }
}
```

#### ✅ 优点
1. **严格的路径检查**：绝对路径、越权、禁止目录全覆盖
2. **命令白名单**：只允许 package.json 中的安全脚本
3. **超时保护**：防止命令执行无限期挂起
4. **环境变量遮蔽**：防止泄露敏感信息

#### ⚠️ 待加强
1. **符号链接检查**：未检测符号链接绕过沙箱
2. **资源限制**：未限制 CPU/内存使用
3. **网络隔离**：浏览器控制未限制网络访问

#### 🔧 建议改进
```typescript
// 1. 添加符号链接检查
validatePath(relativePath: string): string {
  const absolutePath = path.resolve(this.config.projectRoot, relativePath);
  
  // ✅ 检查符号链接
  const realPath = await fs.realpath(absolutePath);
  if (!realPath.startsWith(this.config.projectRoot)) {
    throw this.createError(ErrorCode.E_DENY_PATH, 'Symlink escapes sandbox');
  }
  
  return realPath;
}

// 2. 添加资源限制（使用 child_process 的 options）
const child = spawn(command, args, {
  timeout: this.config.timeoutMs,
  maxBuffer: 10 * 1024 * 1024, // 10MB
  // 可选：使用 cgroups 限制 CPU/内存（Linux）
});
```

---

### 8️⃣ Observability（可观测性）

#### 标准要求
- ✅ 日志到 stderr
- ⚠️ 结构化日志
- ❌ 指标（成功率、耗时）
- ❌ 追踪（traceId）

#### 当前实现
```typescript
// ✅ 日志到 stderr
console.error(`[MCP] projectRoot: ${projectRoot}`);
console.error(`[MCP] snapshotRetention: ${resolved.snapshotRetention}`);
console.error(`[LOCK] acquired (pid: ${process.pid})`);

// ⚠️ 部分结构化
if (config.verbose) {
  console.error(`[MCP] argv: ${process.argv.slice(2).join(' ')}`);
  console.error(`[POLICY] policiesPath: ${policiesPath}`);
  console.error(`[MCP] tools registered: ${toolDefinitions.length}`);
}
```

#### ✅ 优点
1. **日志隔离**：所有日志输出到 stderr
2. **分类前缀**：`[MCP]` / `[LOCK]` / `[POLICY]` 便于过滤
3. **Verbose 模式**：`--verbose` 输出详细调试信息

#### ⚠️ 缺失
1. **结构化日志**：未使用 JSON 格式，难以机器解析
2. **时间戳**：未包含时间戳
3. **日志级别**：未区分 DEBUG/INFO/WARN/ERROR
4. **指标收集**：未统计工具调用次数、成功率、耗时
5. **追踪 ID**：未生成 traceId 关联请求链路

#### 🔧 建议改进
```typescript
// 1. 结构化日志
interface LogEntry {
  ts: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

function log(level: string, component: string, message: string, data?: any) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(data && { data })
  };
  console.error(JSON.stringify(entry));
}

log('INFO', 'MCP', 'Server started', { projectRoot, pid: process.pid });

// 2. 指标收集
class Metrics {
  private counters = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  
  increment(name: string) {
    this.counters.set(name, (this.counters.get(name) || 0) + 1);
  }
  
  recordDuration(name: string, ms: number) {
    if (!this.histograms.has(name)) this.histograms.set(name, []);
    this.histograms.get(name)!.push(ms);
  }
  
  report() {
    return {
      counters: Object.fromEntries(this.counters),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([k, v]) => [
          k,
          { count: v.length, p50: percentile(v, 50), p95: percentile(v, 95) }
        ])
      )
    };
  }
}

// 使用
const metrics = new Metrics();
const start = Date.now();
try {
  const result = await tools.readFile(args);
  metrics.increment('read_file.success');
  metrics.recordDuration('read_file', Date.now() - start);
} catch (error) {
  metrics.increment('read_file.error');
}
```

---

### 9️⃣ Errors & Reliability（错误与韧性）

#### 标准要求
- ✅ JSON-RPC 错误码
- ✅ 用户错误 vs 系统错误
- ⚠️ 超时与取消

#### 当前实现
**错误模型** (`fs-sandbox.ts`):
```typescript
export enum ErrorCode {
  E_DENY_PATH = 'E_DENY_PATH',
  E_NOT_FOUND = 'E_NOT_FOUND',
  E_IO = 'E_IO',
  E_TOO_LARGE = 'E_TOO_LARGE',
  E_ENCODING = 'E_ENCODING',
  E_CONFLICT = 'E_CONFLICT',
  E_TIMEOUT = 'E_TIMEOUT',
  E_POLICY_VIOLATION = 'E_POLICY_VIOLATION',
  // ...
}

export interface ToolError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    hint?: string;
    recoverable?: boolean; // ✅ 区分可恢复错误
  };
}
```

**统一错误处理** (`server.ts`):
```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await tools[name](args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error: any) {
    // ✅ 规范化错误
    const toolError = (error && error.error)
      ? error
      : { error: { code: 'E_INTERNAL', message: error?.message } };
    
    return {
      content: [{ type: 'text', text: JSON.stringify(toolError) }],
      isError: true
    };
  }
});
```

#### ✅ 优点
1. **完整的错误码**：覆盖所有错误场景
2. **可恢复标记**：`recoverable` 字段指导重试策略
3. **详细的错误信息**：`details` + `hint` 帮助调试
4. **统一处理**：所有工具错误都规范化

#### ⚠️ 缺失
1. **超时实现**：虽然定义了 `E_TIMEOUT`，但未在所有工具中实现
2. **取消支持**：长时间操作无法取消
3. **重试逻辑**：未实现自动重试（应由客户端处理）

#### 🔧 建议改进
```typescript
// 1. 添加超时包装器
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject({
        error: {
          code: ErrorCode.E_TIMEOUT,
          message: `Operation timed out: ${operation}`,
          details: { timeoutMs },
          recoverable: true
        }
      }), timeoutMs)
    )
  ]);
}

// 使用
const result = await withTimeout(
  tools.searchFiles(args),
  30000,
  'search_files'
);

// 2. 添加取消支持（使用 AbortController）
async searchFiles(
  request: SearchFilesRequest,
  signal?: AbortSignal
): Promise<SearchFilesResponse> {
  const files = await this.listFiles({ path: request.path });
  
  for (const file of files.entries) {
    if (signal?.aborted) {
      throw { error: { code: ErrorCode.E_CANCELLED, message: 'Operation cancelled' } };
    }
    // ...
  }
}
```

---

### 🔟 Lifecycle（生命周期）

#### 标准要求
- ✅ Initialize → Ready
- ⚠️ Heartbeat/Health
- ✅ Shutdown

#### 当前实现
**初始化** (`bin.ts`):
```typescript
async function main() {
  // 1. 解析参数
  const args = parseArgs();
  
  // 2. 验证项目根
  if (!existsSync(projectRoot)) {
    console.error(`错误: 项目目录不存在: ${projectRoot}`);
    process.exit(1);
  }
  
  // 3. 获取锁
  await acquireLock(projectRoot, 'manual', '0.1.0');
  
  // 4. 加载配置
  const resolved = await loadResolvedConfig(projectRoot, cliOverrides, policiesPath);
  
  // 5. 启动服务器
  await startServer({ projectRoot, ...resolved });
}
```

**关闭** (`lock-manager.ts`):
```typescript
export function registerLockCleanup(projectRoot: string): void {
  const cleanup = () => {
    const lockPath = getLockPath(projectRoot);
    unlinkSync(lockPath); // ✅ 同步释放锁
  };
  
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    cleanup();
    process.exit(1);
  });
}
```

#### ✅ 优点
1. **完整的初始化流程**：参数 → 验证 → 锁 → 配置 → 启动
2. **优雅关闭**：SIGINT/SIGTERM/uncaughtException 全覆盖
3. **资源清理**：退出时自动释放锁

#### ⚠️ 缺失
1. **Heartbeat**：未提供健康检查端点
2. **预热**：未预加载资源（如 Schema 编译）
3. **在途请求等待**：关闭时未等待正在处理的请求完成

#### 🔧 建议改进
```typescript
// 1. 添加健康检查工具
{
  name: 'health_check',
  description: '检查 MCP 服务器健康状态',
  inputSchema: { type: 'object', properties: {} },
}

case 'health_check':
  result = {
    healthy: true,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    lock: await checkLock(config.projectRoot)
  };
  break;

// 2. 优雅关闭（等待在途请求）
let inFlightRequests = 0;

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  inFlightRequests++;
  try {
    return await handleRequest(request);
  } finally {
    inFlightRequests--;
  }
});

process.on('SIGTERM', async () => {
  console.error('[MCP] Shutting down gracefully...');
  
  // 等待在途请求（最多 10 秒）
  const deadline = Date.now() + 10000;
  while (inFlightRequests > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  cleanup();
  process.exit(0);
});
```

---

## 📊 总体评估

### 🟢 核心优势
1. **完整的安全机制**：沙箱、白名单、锁管理
2. **清晰的分层架构**：Bootstrap → Transport → Protocol → Domain
3. **规范的错误处理**：统一错误码、可恢复标记、详细提示
4. **灵活的配置系统**：CLI > policies.json > defaults
5. **快照与幂等**：自动快照、幂等性支持、回滚能力

### ⚠️ 待改进项
1. **可观测性不足**：缺少结构化日志、指标、追踪
2. **高级协议特性**：缺少 Resources/Prompts、流式、取消
3. **运维工具**：缺少 --version、--health、Heartbeat
4. **性能优化**：缺少 Schema 缓存、流式处理
5. **符号链接检查**：安全机制待加强

### 🎯 优先级建议

#### 🔥 高优先级（核心功能）
1. ✅ 添加 `--version` 和 `--health` 标志
2. ✅ 实现结构化日志（JSON 格式 + 时间戳）
3. ✅ 添加符号链接检查
4. ✅ 实现超时包装器（所有工具）

#### ⚡ 中优先级（增强体验）
5. ✅ 添加 Resources 能力（暴露项目资源）
6. ✅ 添加操作 ID（opId）用于追踪
7. ✅ 实现指标收集（成功率、耗时）
8. ✅ 优雅关闭（等待在途请求）

#### 💡 低优先级（高级特性）
9. ⚠️ 添加 Prompts 能力（脚本模板）
10. ⚠️ 实现流式响应（大文件/长任务）
11. ⚠️ 添加取消支持（AbortController）
12. ⚠️ 环境变量支持

---

## 🎓 总结

WebGAL Agent MCP Server 的架构设计**总体符合标准**，核心功能完整且安全可靠。主要优势在于：
- ✅ 严格的安全机制（沙箱、白名单、锁）
- ✅ 清晰的分层架构
- ✅ 规范的错误处理

主要不足在于：
- ⚠️ 可观测性（日志、指标、追踪）
- ⚠️ 高级协议特性（Resources、Prompts、流式）
- ⚠️ 运维工具（健康检查、版本查询）

**建议优先实现高优先级改进项**，以提升生产环境的可维护性和可观测性。

---

**评分**: 🟢 **85/100** - 良好，适合生产使用，部分高级特性待补充
