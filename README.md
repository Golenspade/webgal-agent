太好了—我直接把 README 改成你要的样子：**不提 OODA、架构不改（沿用 Cline 的 Plan→Act）、工具细化、纯本地、Node/Yarn 与 WebGAL 完全对齐、默认用 Terre 一键启动**。你可以把下面整段覆盖当前 `README.md`。

---

# WebGAL Agent (Cline-style Plan→Act, local-only)

**目录说明**
- 根配置
  - `package.json`：Yarn workspaces（`apps/*`、`packages/*`）
  - `tsconfig.base.json`、`.editorconfig`、`.gitignore`、`.prettierrc.json`、`.eslintrc.json`
  - `configs/policies.json`：默认护栏（与 docs/POLICIES.md 对齐）
- 文档（已存在，未改动）
  - `docs/CONTRACTS.md`、`docs/framework.md`、`docs/POLICIES.md`、`docs/PROMPTS.md`、`docs/tools.md`
- 应用（apps）
  - `apps/terre-addon/`：嵌入 WebGAL Terre 的用户侧入口
    - `src/main/bridge.ts`：Electron 主进程桥（IPC/预览/白名单命令，占位）
    - `src/renderer/`：React 面板（`App.tsx`、`components/*`、`state/` 占位）
    - `vite.config.ts`
  - `apps/dev-sandbox/`：本地开发沙箱（不依赖 Terre，最小静态预览，占位）
- 包（packages）
  - `packages/agent-core/`：Agent 核心
    - `src/orchestrator/machine.ts`：计划→生成→校验→预览→写入→快照/回滚（占位）
    - `src/prompt/builder.ts`、`src/tools/*`、`src/policies/guard.ts`、`src/providers/*`（占位）
  - `packages/tool-bridge/`：环境桥（FS 沙箱、命令白名单、本地浏览器动作，占位）
  - `packages/mcp-webgal/`：（可选）MCP 服务器，暴露 `validate_script`/`list_project_resources` 等（占位）
  - `packages/ui-panel/`：UI 组件库（`AgentPanel`、Diff、回滚，占位）
  - `packages/schemas/`：与 CONTRACTS 对齐的 JSON Schemas（占位）
  - `packages/testing/`：E2E 与回归样例（占位）
  - `.changeset/`：版本与发布目录（可选，占位）

Workspaces
- apps：`@webgal-agent/terre-addon`、`@webgal-agent/dev-sandbox`
- packages：`@webgal-agent/agent-core`、`@webgal-agent/tool-bridge`、`@webgal-agent/mcp-webgal`、`@webgal-agent/ui-panel`、`@webgal-agent/schemas`、`@webgal-agent/testing`

> 用自然语言写 WebGAL 脚本，**沿用 Cline 的 Plan→Act 决策循环**，不改架构。
> **纯本地**：文件读写/预览都在本机完成；联网仅用于 **LLM API**（BYOK）与 Cline 的必要 `fetch`。

<p align="center">
  <img alt="demo" src="./docs/demo.gif" height="220"/>
</p>

## ✨ 特性

* **架构不变**：Cline 的 **Plan → Act** 递归循环 + 工具选择；先计划（用户确认）再执行
* **纯本地**：不引入任何云端/远程沙箱；文件操作仅限用户选定的项目根目录
* **工具即能力**：读/写/替换/搜索/列目录 +（可选）本地 MCP 校验与预览封装
* **人-在-回路**：计划确认 + 写入前 **Diff 必经** + 命令白名单（仅开发者模式）
* **对齐 WebGAL**：Node.js / 包管理器 / 启动方式 **完全以 WebGAL 要求与 Terre 为准**

---

## 目录

* [动机](#动机)
* [架构总览（不改 Cline 回路）](#架构总览不改-cline-回路)
* [快速开始](#快速开始)

  * [用户模式（推荐）：Terre 一键启动](#用户模式推荐terre-一键启动)
  * [开发者模式：源码 dev](#开发者模式源码-dev)
* [工具（Tools）— 细化版](#工具tools—-细化版)
* [配置与策略（Policy）](#配置与策略policy)
* [安全与联网边界](#安全与联网边界)
* [故障排查](#故障排查)
* [验收标准](#验收标准)
* [Roadmap](#roadmap)
* [许可证](#许可证)

---

## 动机

把 Cline 成熟的 **Plan→Act** 循环轻量适配到 WebGAL：

> 用户中文描述 → 生成场景计划（确认）→ 产出脚本 → 本地校验/本地预览 → **Diff 确认** → 写入。
> 不引入远端基础设施；**联网仅为 LLM API**（BYOK）。

---

## 架构总览（不改 Cline 回路）

```text
WebGAL Terre (Electron)
┌──────────────────────────────────────────────┐
│ Renderer (React)                             │
│ • 编辑器/舞台（Pixi）                        │
│ • <AgentPanel/>: Chat + Plan + Diff + Preview│
│                 │ IPC                        │
│ Main (Electron) │                            │
│ • Orchestrator（Cline Plan→Act 循环）         │
│ • Tool Bridge（文件/搜索/替换/预览/白名单命令）│
│ • 快照/回滚 + 路径限制（仅项目根内）          │
│                                               
│ 可选：本地 MCP Server（独立 Node 进程，可选）  │
│ • validate_script / list_project_resources    │
│ • preview_scene（封装入口切换+打开本地）       │
└──────────────────────────────────────────────┘
```

* **不引入后端服务**：一切在本机进程内完成
* **可选 MCP**：仅为把 WebGAL 专用能力模块化，依然本地执行

---

## 快速开始

### 先决条件

* **Node.js / 包管理器**：与 **WebGAL / Terre** 的官方要求完全一致（以 WebGAL 文档为准）
* 一个可运行的 **WebGAL 项目**（含 `game/scene` 等目录）
* 你的 **LLM API Key（BYOK）**

### 用户模式（推荐）：Terre 一键启动

1. 启动 **WebGAL Terre**（会自动打开本地编辑器页面，如 `http://localhost:3001`）
2. 打开 **Agent 面板**（本项目），在设置中粘贴你的 API Key（只保存在本地）
3. 在 Agent 面板中选择你的 WebGAL 项目根目录
4. 直接对话创作；预览使用 Terre 的本地页面

### 开发者模式：源码 dev

1. 在你的 WebGAL 引擎/模板项目中运行开发脚本（以项目 `package.json` 为准）

   ```bash
   # 例
   yarn
   yarn dev    # 启动本地预览（端口以项目为准）
   ```
2. 启动本项目的 Agent 面板（同样本地）
3. 预览指向你的本地 dev 端口；其它流程不变

> **说明**：命令执行（`dev/build/lint`）只在**开发者模式**开放，且来自目标项目 `package.json` 的白名单脚本。

---

## 工具（Tools）— 细化版

> 完整 JSON Schema/错误码见 **`tools.md` / `CONTRACTS.md`**。这里给出可直接对接的入参/返回与错误约定。

### 基础文件与检索

1. `list_files`

   * **入参**：`{ path: string, globs?: string[] }`（相对项目根）
   * **出参**：`{ entries: string[] }`
   * **错误**：`E_DENY_PATH`（越权）
2. `read_file`

   * **入参**：`{ path: string, maxBytes?: number }`
   * **出参**：`{ path: string, content: string }`
   * **错误**：`E_NOT_FOUND | E_DENY_PATH | E_ENCODING`
3. `write_to_file`

   * **入参**：`{ path: string, content: string, mode: "overwrite"|"append", dryRun: boolean, idempotencyKey?: string }`
   * **出参**：`{ applied: boolean, diff?: { before: string, after: string }, snapshotId?: string, bytesWritten?: number }`
   * **错误**：`E_CONFLICT | E_DENY_PATH | E_ENCODING`
   * **规则**：**必须**先 `dryRun=true` 拿 diff → UI 确认后再 `dryRun=false`
4. `replace_in_file`

   * **入参**：`{ path: string, find: string, replace: string, flags?: string }`
   * **出参**：`{ count: number }`
   * **错误**：同 `write_to_file`
5. `search_files`

   * **入参**：`{ path: string, regex: string, filePattern?: string }`
   * **出参**：`{ matches: Array<{ path: string, line: number, preview: string }> }`

### WebGAL 专用（推荐做成本地 MCP 工具，也可内置）

6. `list_project_resources`

   * **作用**：聚合 `game/background | figure | bgm | vocal | scene` 清单
   * **出参**：`{ backgrounds: string[], figures: string[], bgm: string[], vocals: string[], scenes: string[] }`
7. `validate_script`

   * **作用**：脚本语法/资源存在校验（分号、未知指令、引用文件存在）
   * **入参**：`{ path?: string, content?: string }`（二选一）
   * **出参**：`{ valid: boolean, diagnostics: Array<{ line: number, kind: "syntax"|"resource"|"style", message: string, fixHint?: string }> }`
   * **错误**：`E_PARSE_FAIL | E_LINT_FAIL`
8. `preview_scene`

   * **作用**：将预览入口指向目标场景并打开本地预览（Terre 首选；或 dev 端口）
   * **入参**：`{ scenePath?: string }`
   * **出参**：`{ url: string, logs?: string[], firstErrorLine?: number }`
   * **错误**：`E_PREVIEW_FAIL | E_TIMEOUT`
9. `generate_character_profile`（可选）

   * **作用**：按项目约定写入角色定义
   * **入参**：`{ name: string, imageFile: string, defaultExpression?: string }`
   * **出参**：`{ success: boolean }`

### 交互与完成信号

10. `ask_followup_question`：在需要澄清时向用户发问
11. `attempt_completion`：明确“任务完成”的结束信号

### 命令与浏览器（仅开发者模式）

12. `execute_command`

* **入参**：`{ scriptName: "dev"|"build"|"lint", args?: string[] }`
* **出参**：`{ ok: boolean, logs: string[] }`
* **限制**：**白名单脚本名** 来自目标项目 `package.json`

13. `browser_action`（如用到）

* **限制**：仅允许 `http://localhost:*` / `http://127.0.0.1:*`

---

## 配置与策略（Policy）

```json
{
  "policies": {
    "sandboxRoot": "${projectRoot}",
    "forbiddenDirs": [".git", "node_modules", ".env"],
    "writeRequiresDiff": true,
    "maxAutoFix": 1,
    "batchMaxLines": 2000,
    "allowedCommands": ["dev", "build", "lint"],
    "browserAllowedHosts": ["localhost", "127.0.0.1"]
  },
  "models": {
    "provider": "anthropic|openai|qwen|deepseek",
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.4
  },
  "byok": {
    "storage": "local",        // localStorage / session
    "keyName": "LLM_API_KEY"
  }
}
```

* **不提供** 任何远端沙箱配置
* **联网白名单**：仅 LLM API 与必要的 `fetch`（Cline 内部）

---

## 安全与联网边界

* **纯本地文件访问**：所有路径必须在项目根内；拒绝绝对路径与 `..` 越权
* **无云端沙箱/无遥测**：不上传本地文件，不调用远端文件系统
* **联网仅用于**：LLM 推理 API 与 Cline 的必要 `fetch`；域名由模型提供商决定（BYOK）
* **写入前 Diff**：无“强制覆盖”路径；落盘记录 `snapshotId` 可回滚
* **开发者模式** 才开放命令与浏览器控制，且均受白名单/本地域限制

---

## 故障排查

* **预览打不开**：确认 Terre 已启动或 dev 端口存在；避免端口占用
* **资源缺失**：先调用 `list_project_resources`，或在 `validate_script` 的 `diagnostics` 中查看建议替代
* **写入冲突**：`E_CONFLICT` → 自动重读文件、重新出 Diff
* **限流/超时**：降低批量大小（`batchMaxLines`）或稍后重试

---

## 验收标准

* 生成的脚本通过 `validate_script`；预览能进入目标场景且无致命错误
* 写入前展示 **Diff** 并确认；写入后返回 `snapshotId` 可回滚
* 搜索/替换仅在 `game/scene` 内安全生效
* 命令与浏览器能力仅在**开发者模式**启用，且受白名单/本地域限制

---

## Roadmap

* **Phase 1（MVP）**：基础文件工具 + 计划确认 + Diff 写入 + BYOK
* **Phase 2（增强）**：本地 MCP 校验器/预览封装、流式生成、快照回滚
* **Phase 3（完善）**：截图回归、资源缺失智能建议

---

## 许可证

* 本项目与 Cline 保持 **Apache-2.0**（示例），请按其 NOTICE 要求保留致谢

---
