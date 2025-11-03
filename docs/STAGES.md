# WebGAL Agent – Stages Roadmap (Reference)

本文件作为阶段性路线图与验收参照，结合现有文档与代码现状而定：
- 规范与契约：`docs/CONTRACTS.md`, `docs/POLICIES.md`
- 实现现状：`docs/IMPLEMENTATION_STATUS.md`
- 关键包：`@webgal-agent/{agent-core, tool-bridge, mcp-webgal}` 与 WebGAL Terre（`packages/terre2`, `packages/origine2`）

通用约定（重要）
- 不改预览逻辑与位置：预览依然在 Terre 的既有区域，Agent 仅提供 URL/引导。
- 左侧面板 Scenes/Assets 共用一块区域，通过按钮切换，不改变现有交互。
- 日志/调试默认隐藏，仅在失败场景可折叠查看。
- 工具错误统一使用 CONTRACTS 的 `ToolError` 形状（`code/message/hint/details/recoverable`）。
- MCP stdio 传输：换行分隔 JSON（非 LSP Content-Length 帧）。

---

## Stage 1 — MCP Server Scaffolding（已完成）
目标
- 提供最小可用的 MCP stdio 服务器，暴露文件/校验/资源/预览等工具。

交付物
- `packages/mcp-webgal/src/server.ts`（基于 MCP SDK 的 stdio Server）
- `packages/mcp-webgal/src/bin.ts`（CLI 入口）
- 工具映射：`list_files/read_file/write_to_file/replace_in_file/search_files/validate_script/list_project_resources/preview_scene/ask/attempt_completion`

验收
- 可通过 CLI 启动，`tools/list` 列出工具，`tools/call` 可用；错误以 ToolError 透传。

---

## Stage 2 — CLI + Config Wiring（已完成）
目标
- 提供开箱可用的 CLI/策略加载与合并，安全默认关闭敏感能力。

交付物
- `packages/mcp-webgal/src/config.ts`：加载/合并（默认值 ← policies.json ← CLI 覆盖）
- CLI flags：`--project --policies --retention --enable-exec --enable-browser` 与 sandbox/exec/browser 细粒度覆盖
- 根级脚本：`mcp:start`/`mcp:dev`/`mcp:sandbox`

验收
- 在真实项目根下可一键启动；状态/工具列表/调用成功；默认 exec/browser 关闭。

---

## Stage 3 — Terre 集成

### 3.1 Backend Bridge（已完成）
目标
- 在 Terre 后端（Nest，`packages/terre2`）托管 MCP 子进程，通过 REST 转发工具调用。

交付物
- `Modules/agent/agent-mcp.service.ts`：spawn MCP（TS 源码或 dist），newline JSON 编解码，`initialize` 握手，`tools/list` 与 `tools/call`，结果解包（`content[0].text`）。
- `Modules/agent/agent.controller.ts`：`/api/agent/status|start|stop|tools|call` REST API；HTTP 错误码映射。
- `Modules/agent/agent.module.ts` + `app.module.ts` 引入。

验收
- 以 REST 方式列工具/调用工具成功；MCP 生命周期可控；错误按 HTTP 状态透传。

### 3.2 AgentPanel（前端 UI）
3.2.1 外壳（已完成）
- 在 Terre 主工作区新增 “Agent” 模式（与“脚本/图形”同级）。
- Store：`isAgentMode` + 工具条按钮切换，不动左侧面板与预览。

3.2.2 最小闭环（已完成）
- API 客户端：`origine2/src/api/agentClient.ts` 封装 `/api/agent/*`。
- 组件：`AgentPanel` + `AgentHeader/AgentActions/AgentResults/DiffViewer/ErrorBanner/ValidationResults/ResourcesList`。
- 流程：读取 → 编辑 → Dry‑run Diff → Apply（快照） → 校验 → 资源清单。

验收
- 显示连接状态；完成“读取→Dry‑run→Apply”的闭环；错误以 ToolError 渲染；未改动预览区域。

---

## Stage 3.3 — 快照时间线 + UX 打磨（下一阶段）
目标
- 时间线展示快照元信息，支持“选择快照→预览 Diff→确认恢复”。补充常见 UX 提示。

工具层（agent-core）
- 新增：`listSnapshots({ limit?, path? })` 返回 `SnapshotMetadata[]`（按 `timestamp` 降序）。
- 复用：`restoreSnapshot(snapshotId)` 返回 `{ path, content }`。
- WebGALAgentTools 导出 `list_snapshots` / `restore_snapshot`。

MCP（mcp-webgal）
- 暴露 `list_snapshots` / `restore_snapshot` 工具，仍用文本 content 封装。

Terre 前端（origine2）
- `SnapshotTimeline` 组件：列表（id/path/time/hash），筛选（path/limit）。
- 行为：点击条目→调用 `restore_snapshot` 得到 `{path, content}`→ 用 `write_to_file(dryRun=true)` 预览 Diff → 确认后 `dryRun=false` Apply。
- UX：
  - E_CONFLICT 提供“一键重新 Dry‑run”。
  - Apply 成功支持复制 `snapshotId`。
  - 按钮级 loading 与结果提示优化。

验收
- 能浏览/筛选最近快照，预览 Diff 并恢复；错误提示与重试友好；不改预览逻辑。

---

## Stage 4 — 构建与文档
目标
- 完善各包构建产物与快速指南，降低集成门槛。

交付物
- 各包 `build` 产物（`dist`），CLI 指向 `dist/bin.js`。
- QUICKSTART：从“连接项目”到“Dry‑run→Apply→快照回滚”的操作示例与常见错误对照。

验收
- 纯按文档即可完成最小闭环；构建/脚本稳定。

---

## Stage 5 — AI Orchestrator + Chat（可选/后续）
目标
- 在 Agent 工作区增加 Chat，支持 Plan→Act 回路。联网仅用于 LLM（BYOK）。

后端（terre2）
- `POST /api/agent/chat`（SSE）：Orchestrator 接收 LLM 输出的 tool-use，调用 `/api/agent/call`，严格白名单与 Dry‑run→确认→落盘。

前端（origine2）
- Chat 视图：消息/步骤卡（工具调用/诊断/Diff 卡，带“确认写入”按钮）。

验收
- Chat 可生成计划/建议，能调用工具；写入前必经 Diff 卡并需用户确认；不改预览区域。

---

## Stage 6 — 进阶能力（可选）
- 浏览器自动化：集成 Playwright 完成 `browser_action` 真正落地（仍限制 localhost）。
- Git 集成：在 Apply 后可选生成提交（不默认）。
- 端到端测试：覆盖“读取→生成→校验→Diff→落盘→回滚”的完整链路。

---

## 附录
常用错误码→HTTP 映射（参考）
- 404: `E_NOT_FOUND`
- 400: `E_BAD_ARGS`
- 409: `E_CONFLICT`
- 408: `E_TIMEOUT`
- 403: `E_POLICY_VIOLATION`（或 `E_DENY_PATH`）
- 413: `E_TOO_LARGE`
- 422: `E_ENCODING` / `E_PARSE_FAIL` / `E_LINT_FAIL`
- 500: `E_PREVIEW_FAIL` / `E_INTERNAL` / `E_IO`

工具清单（与 CONTRACTS 对齐）
- 基础：`list_files` `read_file` `write_to_file` `replace_in_file` `search_files`
- WebGAL：`validate_script` `list_project_resources` `preview_scene`
- 交互：`ask_followup_question` `attempt_completion`
- Dev：`execute_command` `browser_action`（默认禁用）
- 快照（3.3）：`list_snapshots` `restore_snapshot`

