# Stage 4 — 稳定交付和可分发 详细计划

## 整体目标

1. **稳定交付和可分发**：构建 dist、CLI 指向 dist、最小配置一键使用
2. **运行时可靠性**：并发写入互斥、幂等持久化、错误与恢复路径清晰
3. **Cline-first**：默认用 Cline 作为 Agent；Terre 前端保留观测/回滚与手动闭环，不与 Cline 并发启动 MCP

## 实施顺序（建议）

1. **后端**：锁 + 幂等持久化 + get_runtime_info 扩展 → stdio e2e 测试 → CLI 构建产物
2. **前端**：Runtime 卡片与锁提示 → SnapshotTimeline 竞态修复 → ErrorBanner 动态提示 → 运行模式提示
3. **文档**：STAGES/QUICKSTART/CLINE_GUIDE/TROUBLESHOOTING
4. **可选**：HTTP/SSE 传输与共用实例（4.2）

---

## 4.1 后端（webgal_agent）— 构建与发布

### 目标
产出 dist/bin.js（shebang + 可执行）、package.json bin 指向 dist、prepublishOnly 构建、帮助文档整理

### 任务清单

#### 4.1.1 配置 mcp-webgal 构建
- **文件**: `packages/mcp-webgal/package.json`
- **修改**:
  ```json
  {
    "bin": {
      "mcp-webgal": "./dist/bin.js"
    },
    "scripts": {
      "build": "tsc",
      "prepublishOnly": "yarn build"
    },
    "files": ["dist", "README.md", "LICENSE"]
  }
  ```

#### 4.1.2 添加 shebang 到 bin.ts
- **文件**: `packages/mcp-webgal/src/bin.ts`
- **修改**: 首行添加 `#!/usr/bin/env node`

#### 4.1.3 测试构建流程
- 运行 `yarn build` 在 `packages/mcp-webgal`
- 验证 `dist/bin.js` 生成且可执行
- 测试 `node dist/bin.js --help` 正常输出

#### 4.1.4 配置其他包的 exports
- **文件**: `packages/agent-core/package.json`, `packages/tool-bridge/package.json`, `packages/schemas/package.json`
- **确保**: exports/types/main 字段正确指向 dist

### 验收标准
- ✅ `yarn build` 后 `node packages/mcp-webgal/dist/bin.js --project <root>` 能启动
- ✅ `tools/list` 正常返回工具列表

---

## 4.2 后端 — 运行时互斥（锁）

### 目标
在项目根 `.webgal_agent/agent.lock` 保存 JSON（owner/pid/host/startedAt/version）、mcp-webgal 启动时创建（O_EXCL）、退出清理、get_runtime_info 增加 lock 字段、Terre 启动前检测锁

### 锁文件结构
```json
{
  "owner": "cline" | "terre" | "manual",
  "pid": 12345,
  "host": "hostname",
  "startedAt": 1699999999999,
  "version": "0.1.0"
}
```

### 任务清单

#### 4.2.1 设计锁文件结构
- 定义 TypeScript 接口 `AgentLock`

#### 4.2.2 实现锁管理器
- **文件**: `packages/mcp-webgal/src/lock-manager.ts`
- **方法**:
  - `acquireLock(projectRoot: string, owner: string): Promise<void>` - 使用 `fs.open()` 的 `O_EXCL` 标志
  - `releaseLock(projectRoot: string): Promise<void>` - 删除锁文件
  - `checkLock(projectRoot: string): Promise<AgentLock | null>` - 读取锁信息

#### 4.2.3 集成锁到 MCP 启动流程
- **文件**: `packages/mcp-webgal/src/bin.ts`
- **修改**: 在 `main()` 函数中
  - 在 `startServer()` 之前调用 `acquireLock(projectRoot, 'manual')`
  - 注册 `process.on('exit')` 和 `SIGTERM/SIGINT` 处理器调用 `releaseLock()`

#### 4.2.4 扩展 get_runtime_info 返回 lock 信息
- **文件**: `packages/mcp-webgal/src/server.ts`
- **修改**: 在 `get_runtime_info` 处理器中调用 `checkLock()` 并添加到响应

#### 4.2.5 Terre 后端检测锁
- **文件**: `WebGAL_Terre/packages/terre2/src/Modules/agent/agent-mcp.service.ts`
- **修改**: 在 `start()` 方法中，启动前检查 `.webgal_agent/agent.lock`
  - 如果存在且 owner 不是 'terre'，抛出错误并提示

#### 4.2.6 更新 schemas
- **文件**: `packages/schemas/get_runtime_info.response.json`
- **添加**:
  ```json
  "lock": {
    "type": "object",
    "description": "当前运行时锁信息（如果存在）",
    "properties": {
      "owner": { "type": "string", "enum": ["cline", "terre", "manual"] },
      "pid": { "type": "integer" },
      "host": { "type": "string" },
      "startedAt": { "type": "integer" },
      "version": { "type": "string" }
    }
  }
  ```

### 验收标准
- ✅ 同一项目根第二个进程无法启动，返回明确错误信息
- ✅ Terre UI/RuntimeInfo 展示锁状态
- ✅ 进程退出后锁文件自动清理

---

## 4.3 后端 — 幂等持久化（write_to_file）

### 目标
`.webgal_agent/idem.json` 集中 KV 文件（LRU 清理）、写入成功时落 KV、命中直接返回历史 snapshotId、清理策略（最多 N=500 或 7 天）

### 存储结构
```json
{
  "key-1": {
    "snapshotId": "snap_20231103T123456_abcd1234",
    "timestamp": 1699999999999
  },
  "key-2": { ... }
}
```

### 任务清单

#### 4.3.1 设计幂等存储结构
- 选择方案：`.webgal_agent/idem.json` 集中 KV 文件

#### 4.3.2 实现幂等管理器
- **文件**: `packages/agent-core/src/tools/diff-snapshot.ts`
- **扩展 SnapshotManager**:
  - `loadIdempotencyCache(): Promise<void>` - 从 idem.json 加载
  - `saveIdempotencyEntry(key: string, snapshotId: string): Promise<void>` - 保存条目
  - `getIdempotencyEntry(key: string): string | null` - 查询条目
  - `cleanupIdempotencyCache(): Promise<void>` - LRU 清理

#### 4.3.3 集成到 writeToFile
- **文件**: `packages/agent-core/src/tools/fs.ts`
- **修改**: 在 `writeToFile()` 实际写入模式下
  - 先调用 `getIdempotencyEntry(idempotencyKey)`
  - 如果命中，直接返回 `{ applied: true, snapshotId: cachedId }`
  - 写入成功后调用 `saveIdempotencyEntry()`

#### 4.3.4 实现清理策略
- **逻辑**: 在 `cleanupIdempotencyCache()` 中
  - 最多保留 500 条（按 timestamp 排序）
  - 删除 7 天前的条目

#### 4.3.5 添加配置选项
- **文件**: `packages/mcp-webgal/src/config.ts`
- **添加**:
  ```typescript
  idempotency?: {
    maxEntries: number;  // 默认 500
    maxAgeDays: number;  // 默认 7
  }
  ```
- 支持 CLI 和 policies.json 覆盖

### 验收标准
- ✅ 重启进程后相同幂等键仍避免重复 apply
- ✅ KV 自动清理（最多 500 条或 7 天）

---

## 4.4 后端 — 工具与错误模型增强

### 目标
get_runtime_info 新增 policiesPath、lock 字段；write/replace 在 E_CONFLICT 的 hint 包含具体步骤；E_TOO_LARGE 提示当前 sandbox.maxReadBytes

### 任务清单

#### 4.4.1 扩展 get_runtime_info schema
- **文件**: `packages/schemas/get_runtime_info.response.json`
- **添加**: `policiesPath` 字段（可选）

#### 4.4.2 实现 get_runtime_info 返回 policiesPath
- **文件**: `packages/mcp-webgal/src/server.ts`
- **修改**: 将 config 中的 policiesPath 添加到响应（如果存在）

#### 4.4.3 增强 E_CONFLICT 错误提示
- **文件**: `packages/agent-core/src/tools/fs.ts`
- **修改**: 在 `writeToFile()` 抛出 E_CONFLICT 时
  ```typescript
  hint: '文件已被修改，请按以下步骤重试：\n1. 读取最新文件内容\n2. 重新执行 Dry-run\n3. 检查 diff 确认变更\n4. 执行 Apply'
  ```

#### 4.4.4 增强 E_TOO_LARGE 错误提示
- **文件**: `packages/tool-bridge/src/fs-sandbox.ts`
- **修改**: 在抛出 E_TOO_LARGE 时
  ```typescript
  hint: `文件大小超过限制。当前 maxReadBytes: ${this.config.maxReadBytes} 字节。可在 policies.json 中调整此参数。`
  ```

#### 4.4.5 增强 replaceInFile 错误提示
- **文件**: `packages/agent-core/src/tools/fs.ts`
- **修改**: 在 `replaceInFile()` 中添加类似的具体步骤提示

### 验收标准
- ✅ ErrorBanner（Terre）与 Cline 都能显示具体化建议
- ✅ E_TOO_LARGE 显示当前 maxReadBytes 值

---

## 4.5 后端 — 端到端与回归测试

### 目标
MCP stdio（packages/testing）：新增三条完整链路（小改/全量/回滚）、锁/幂等测试（并行启动冲突、重启后幂等命中）

### 任务清单

#### 4.5.1 添加小改链路测试
- **文件**: `packages/testing/src/e2e-workflows.test.ts`
- **测试**: replace_in_file → validate_script → dry-run → apply → 快照存在

#### 4.5.2 添加全量链路测试
- **测试**: write_to_file (dry-run) → apply → validate_script → 快照存在

#### 4.5.3 添加回滚链路测试
- **测试**: list_snapshots → restore_snapshot → dry-run → apply

#### 4.5.4 添加锁冲突测试
- **测试**: 并行启动两个 MCP 进程，验证第二个启动失败并返回锁信息

#### 4.5.5 添加幂等持久化测试
- **测试**:
  1. 使用相同 idempotencyKey 写入两次，验证第二次返回相同 snapshotId
  2. 重启进程后再次写入，验证仍然命中

#### 4.5.6 集成到测试套件
- **文件**: `packages/testing/src/all.test.ts`
- **修改**: 添加新的测试 runner

### 验收标准
- ✅ CI 通过
- ✅ 断言 ToolError 形状、schema 形状一致

---

## 4.6 后端 — 日志与可观测性

### 目标
CLI 启动输出简明（项目根、retention、exec/browser 开关、tools 数量、锁状态）、可选：隐藏详细堆栈，使用 --verbose 输出 debug

### 任务清单
- **文件**: `packages/mcp-webgal/src/bin.ts`
- **修改**: 在启动时输出锁状态和工具数量
- **可选**: 添加 `--verbose` 标志控制详细日志

---

## 4.7-4.13 前端（WebGAL_Terre）任务

详见任务列表，包括：
- 运行模式与连接 UX
- Runtime 卡片增强
- SnapshotTimeline 健壮性
- ErrorBanner 动态提示
- 只读观测模式
- 文案国际化补全
- 文档入口与引导

---

## 4.14 文档（两端共用）

### 任务清单
1. **STAGES.md**: 更新至 3.4 完成 + 4 目标与验收
2. **QUICKSTART.md**: 补一张结构图与锁/幂等说明
3. **CLINE_WEBGAL_INTEGRATION.md**: 补充 .clinerules 复制路径说明与截图
4. **TROUBLESHOOTING.md**（新增）: 锁冲突、E_TOOL_DISABLED、E_TOO_LARGE、policies 未生效等

---

## 验收清单

- [ ] 单一 MCP 实例互斥；锁信息在 Runtime 卡片可见
- [ ] 幂等键重启后仍生效
- [ ] Terre 与 stdio 路径三条 e2e 测试通过（小改/全量/回滚）
- [ ] 前端运行模式提示清晰；只读/回滚策略明确；错误提示带有上下文数值
- [ ] dist 构建可直接分发；Cline 集成按文档可一键接入
