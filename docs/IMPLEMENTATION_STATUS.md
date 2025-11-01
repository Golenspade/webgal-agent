# WebGAL Agent MVP 实现状态

## 概览

本文档记录 WebGAL Agent MVP（最小可行产品）的实现状态。

**目标**: 跑通"生成→校验→预览→Diff 审核→落盘→回滚"的最小闭环

**模式**: Dev 模式（允许白名单命令与本地浏览器自动化）

**合规性**: 严格按照 `CONTRACTS.md` 规范实现

---

## ✅ 已完成功能

### 1. 工具桥（Tool Bridge）基础设施

**位置**: `packages/tool-bridge/src/`

#### 1.1 文件系统沙箱 (`fs-sandbox.ts`)
- ✅ 路径校验（仅项目根内，禁绝绝对路径/..）
- ✅ 禁止目录（.git, node_modules, .env, .webgal_agent）
- ✅ 统一错误码（ErrorCode 枚举）
- ✅ 统一错误结构（ToolError 接口）

#### 1.2 命令白名单执行器 (`exec-whitelist.ts`)
- ✅ 从 package.json 动态收集允许的命令
- ✅ 白名单验证（仅 dev/build/lint）
- ✅ 超时保护（默认 180 秒）
- ✅ 环境变量遮蔽
- ✅ 日志收集

#### 1.3 浏览器本地访问控制 (`browser-local.ts`)
- ✅ URL 白名单（仅 localhost/127.0.0.1）
- ✅ 请求验证
- ✅ 超时保护（默认 30 秒）
- ⚠️ 实际浏览器自动化（占位，待集成 Playwright）

---

### 2. 基础文件工具

**位置**: `packages/agent-core/src/tools/fs.ts`

#### 2.1 list_files
- ✅ 目录列出
- ✅ Glob 模式支持
- ✅ 递归选项

#### 2.2 read_file
- ✅ UTF-8 读取
- ✅ 大小限制（默认 1MB）
- ✅ 错误处理

#### 2.3 write_to_file
- ✅ **Dry-run 模式**（返回 diff，不实际写入）
- ✅ **Diff 计算**（结构化 hunks）
- ✅ **快照管理**（.webgal_agent/snapshots/）
- ✅ **幂等性**（idempotencyKey 缓存）
- ✅ **并发冲突检测**（文件哈希比对）
- ✅ **原子写入**（临时文件 + 重命名）
- ✅ 快照保留策略（默认 20 个）

#### 2.4 replace_in_file
- ✅ 正则替换
- ✅ 返回替换次数
- ✅ 非法正则错误处理（E_BAD_ARGS）

#### 2.5 search_files
- ✅ 多文件正则搜索
- ✅ Glob 模式
- ✅ 匹配数量限制

---

### 3. WebGAL 专用工具

**位置**: `packages/agent-core/src/tools/`

#### 3.1 validate_script (`validate.ts`)
- ✅ **分号检查**（语句必须以分号结尾）
- ✅ **指令白名单**（changeBg, bgm, choose, changeScene 等）
- ✅ **资源引用校验**（背景、立绘、BGM、场景文件存在性）
- ✅ **结构化诊断**（line, kind, message, fixHint）
- ✅ 错误类型：syntax / resource / style

#### 3.2 list_project_resources (`preview.ts`)
- ✅ 列出背景（game/background）
- ✅ 列出立绘（game/figure）
- ✅ 列出 BGM（game/bgm）
- ✅ 列出语音（game/vocal）
- ✅ 列出场景（game/scene）
- ✅ 文件类型过滤（图片、音频）

#### 3.3 preview_scene (`preview.ts`)
- ✅ 场景文件存在性检查
- ✅ 自动启动 dev 服务器
- ✅ 从日志提取端口号
- ✅ 构建预览 URL（带场景参数）
- ✅ 错误处理（E_PREVIEW_FAIL, E_NOT_FOUND）

---

### 4. 交互工具

**位置**: `packages/agent-core/src/tools/interact.ts`

#### 4.1 ask_followup_question
- ✅ 占位实现（console.log）
- ⚠️ 待集成 UI 层

#### 4.2 attempt_completion
- ✅ 占位实现（console.log）
- ⚠️ 待集成 UI 层

---

### 5. 命令执行与浏览器（dev 模式）

**位置**: `packages/agent-core/src/tools/index.ts`

#### 5.1 execute_command
- ✅ 白名单验证
- ✅ 超时处理
- ✅ 日志收集
- ✅ 错误处理（E_POLICY_VIOLATION, E_TIMEOUT）

#### 5.2 browser_action
- ✅ URL 白名单验证
- ✅ 请求验证
- ⚠️ 实际浏览器操作（占位）

---

### 6. Diff 计算与快照系统

**位置**: `packages/agent-core/src/tools/diff-snapshot.ts`

#### 6.1 SnapshotManager
- ✅ 快照创建（snap_YYYYMMDDThhmmss_<8hex>）
- ✅ 快照保留（最近 20 个）
- ✅ 幂等性缓存（idempotencyKey → snapshotId）
- ✅ 元数据存储（.meta.json）

#### 6.2 computeDiff
- ✅ 行级 Diff 算法
- ✅ 结构化 hunks（startOld, lenOld, startNew, lenNew）
- ✅ 上下文行

#### 6.3 applyDiff
- ✅ Diff 应用（占位）

---

### 7. 配置与策略

**位置**: `webgal_agent/configs/policies.json`

- ✅ 沙箱配置（root, forbiddenDirs, maxReadBytes）
- ✅ 写入策略（requireDiff, idempotency, snapshotRetention）
- ✅ 执行策略（enabled, allowedCommands, timeoutMs）
- ✅ 浏览器策略（enabled, allowedHosts, timeoutMs）
- ✅ 模型配置（provider, model, temperature）
- ✅ Hooks 配置（beforeActBatch, reorientOn）
- ✅ 限流配置（rpm, burst）

---

### 8. 测试用例

**位置**: `packages/testing/src/`

#### 8.1 测试工具 (`test-utils.ts`)
- ✅ 临时项目创建
- ✅ 资源文件生成
- ✅ 断言函数
- ✅ 测试运行器

#### 8.2 工具测试 (`tools.test.ts`)
- ✅ write_to_file: dry-run 返回 diff
- ✅ write_to_file: 实际写入返回 snapshotId
- ✅ write_to_file: 幂等性防止重复写入
- ✅ replace_in_file: 返回替换次数
- ✅ validate_script: 检测缺少分号
- ✅ validate_script: 检测资源缺失
- ✅ list_project_resources: 列出所有资源

---

## ⚠️ 待完成/待集成

### 1. 浏览器自动化
- 需要集成 Playwright 或类似库
- 实现真实的 click、screenshot 等操作

### 2. 交互层
- 需要集成 UI 层（如 VSCode Extension）
- 实现真实的用户追问和完成确认

### 3. 测试执行
- 需要安装依赖并运行测试
- 验证所有功能正常工作

### 4. 端到端测试
- 完整的"生成→校验→预览→Diff→落盘→回滚"流程测试

---

## 📋 验收清单

### 必做功能（MVP）

- [x] 工具桥（本地实现，严格 JSON Schema）
  - [x] list_files / read_file / write_to_file / replace_in_file / search_files
  - [x] ask_followup_question / attempt_completion（交互占位）

- [x] 安全护栏（dev 模式开启但受限）
  - [x] 路径沙箱（仅项目根内，禁绝绝对路径/..，屏蔽 .git/node_modules/.env）
  - [x] 命令白名单：来自目标项目 package.json，仅 dev/build/lint
  - [x] 浏览器白名单：仅 localhost/127.0.0.1

- [x] 写入工作流（强制 Diff 确认）
  - [x] dryRun=true → 返回 diff
  - [x] 用户确认 → dryRun=false → 落盘 + snapshotId
  - [x] 幂等性：idempotencyKey 防重
  - [x] 并发冲突检测

- [x] WebGAL 专用工具
  - [x] validate_script（分号/指令/资源校验）
  - [x] list_project_resources（聚合资源）
  - [x] preview_scene（自动启动 dev + 浏览器）

- [x] 错误处理
  - [x] write_to_file: dryRun→diff 存在；落盘→snapshotId 存在；并发外改→E_CONFLICT
  - [x] replace_in_file: 返回 count；非法正则→E_BAD_ARGS
  - [x] validate_script: 缺分号→syntax；未知指令→syntax；资源缺失→resource
  - [x] preview_scene: 服务未起→自动执行 dev；dev 启动失败/超时→E_TIMEOUT
  - [x] execute_command: 非白名单脚本→E_POLICY_VIOLATION

---

## 🚀 下一步

1. **安装依赖**: `npm install` 或 `pnpm install`
2. **运行测试**: `cd packages/testing && npm test`
3. **修复测试失败**（如果有）
4. **集成 UI 层**（VSCode Extension 或 CLI）
5. **端到端测试**（真实 WebGAL 项目）
6. **文档完善**（使用示例、API 文档）

---

## 📝 备注

- 所有实现严格遵循 `CONTRACTS.md` 规范
- 错误码、请求/响应结构完全对齐
- 代码包含详细注释和类型定义
- 测试覆盖关键功能路径

