下面是整理后的**终稿**，已经把前面核验得到的修正与取舍都融合进去，适合直接放进 README/设计文档。

---

# 🏗️ Cline → WebGAL Agent 架构适配方案（终稿）

> **目标**：在不加重社区负担的前提下，把 Cline 的“计划→工具→人在回路”范式，轻量适配到 WebGAL（脚本创作/预览）场景。
> **原则**：默认**零后端/不自创花活/能力=工具面**；必要时再渐进增加可选组件（如 MCP 校验器、极薄代理）。

---

## 0. 约束与范围

* **运行形态**：优先集成到 **WebGAL Terre（桌面编辑器 / Electron）** 或 Web 端；不强制新增后端。
* **模型调用**：默认 **BYOK**（用户自带 Key，前端直连），后续如需保护再加“极薄代理”（不改变前端契约）。
* **功能边界**：**Agent 能做 = 用户在 WebGAL 能做**（读/写脚本、校验、预览、资源检索），**不**执行任意系统命令/网络爬取。
* **安全**：路径沙箱、命令白名单、本地预览域限制、写入前 **Diff 二次确认**。

---

## 1. 架构对比与目标形态

### 1.1 Cline（原生形态，摘要）

* **宿主**：VS Code 扩展（Webview UI + Extension 主体）。
* **能力**：文件/终端/浏览器/MCP/交互等工具；递归式 Task 编排。
* **工具示例**：`read_file`、`write_to_file`、`replace_in_file`、`search_files`、`list_files`、`execute_command`、`ask_followup_question`、`attempt_completion`、`use_mcp_tool` 等。

### 1.2 WebGAL Agent（目标形态，轻重可调）

```
┌───────────────────────────────────────────────┐
│           WebGAL Terre（Electron）           │
├───────────────────────────────────────────────┤
│  渲染进程（React）：                         │
│  • 编辑器 UI / 舞台（Pixi）                  │
│  • AI 面板 <AgentPanel/>（方案二：UI 轻重构）│
│      ↕ IPC                                   │
│  主进程（Electron Main）：                    │
│  • Orchestrator（Web Worker 可选）           │
│  • Tool Bridge（文件/预览/校验/检索）        │
│  • 命令白名单执行器（可选）                  │
│                                               │
│  可选：MCP Server（独立进程/Node）           │
│  • validate_script / list_project_resources   │
│  •（后续可扩展更多 WebGAL 专用能力）          │
└───────────────────────────────────────────────┘
```

> 说明：不**默认**引入 NestJS 等重型后端；若未来要做多人协作、权限、审计，再按需扩展。

---

## 2. 工具适配矩阵（以“最小可用”优先）

| 工具                                     | 作用             | 适配性 | 备注/约束                                            |
| -------------------------------------- | -------------- | --- | ------------------------------------------------ |
| `read_file`                            | 读 `.txt` 剧本/配置 | ✅   | 路径沙箱（项目根内）                                       |
| `write_to_file`                        | 写/改脚本          | ✅   | **先 dry-run 出 Diff → UI 确认 → 真写**                |
| `replace_in_file`                      | 定点/批量替换        | ✅   | 比整文件覆写更稳                                         |
| `search_files`                         | 正则搜索台词/指令      | ✅   | 仅限项目内 `game/scene` 等                             |
| `list_files`                           | 列目录（场景/资源）     | ✅   | 过滤到 `game/*` 子目录                                 |
| `execute_command`                      | 启动/构建          | ⚠️  | **白名单**：按 `package.json` 的 `dev/build/lint` 动态收集 |
| 远程浏览器（browser）                         | 预览/截图回归        | ✅   | 仅允许 `localhost`                                  |
| `ask_followup_question`                | 追问澄清           | ✅   | 人在回路                                             |
| `attempt_completion`                   | 呈现结果/总结        | ✅   | ——                                               |
| `use_mcp_tool` / `access_mcp_resource` | 扩展专用能力         | ✅   | **推荐**把 WebGAL 校验/聚合作为 MCP                       |

> **可选新增（WebGAL 专用）**：建议优先以 **MCP 工具**提供
> • `validate_script`（脚本/资源校验）
> • `list_project_resources`（一次性返回背景/立绘/BGM/场景清单）
> • `preview_scene`（直达预览流程封装：入口调整+打开本地）
> • `generate_character_profile`（按项目约定写入角色配置）

---

## 3. System Prompt（骨架，面向 WebGAL DSL）

* 你的身份：**WebGAL 剧本助手**。
* 仅做两类输出：**（A）WebGAL 脚本** 或 **（B）工具调用**。
* **硬规则**：

  * 对白：`角色: 台词;`，每句**必须**以分号结束；
  * 常用指令：`changeBg: 文件;`，`bgm: 文件;`，`choose: 选项:场景A.txt|选项:场景B.txt;` 等；
  * **先查后用**：引用背景/立绘/BGM/场景**必须**来自项目已有资源清单；不确定先提问；
* **工作流**：

  1. 产出**场景计划/资源表（JSON）** → 等用户确认；
  2. 按场景分批**生成脚本** → `validate_script` → 预览（失败尝试**一次**自修复）；
  3. `write_to_file`（先 `dryRun` 出 Diff，用户确认后落盘）。
* **中文输出**，少讲解，多结果。

---

## 4. Orchestrator 状态机（Cline 风格，精简）

```
Idle
 └─► Planning → AwaitPlanConfirm
                 └─► Generating → Linting(validate_script) → Previewing
                          ├─ ok ─► AwaitWriteConfirm → Writing(applied) → Next/Done
                          └─ err ─► Fixing(自修1次) ─► Lint/Preview
Error / Rollback(snapshotId)
```

* **自修上限**：每批最多 1 次；失败则把错误与建议交给用户决策。
* **快照回滚**：`write_to_file` 成功后返回 `snapshotId`，UI 提供回滚按钮。

---

## 5. 预览路径（两类，二选其一/并存）

* **Terre 预览（推荐）**：用户启动 WebGAL Terre，Agent 通过浏览器工具打开 `http://localhost:3001` 并执行最小化操作（点击开始、截图）。
* **源码预览**：在项目根执行 `dev` 脚本（**白名单**收集 `package.json` 中的命令），再用浏览器工具打开 `http://localhost:<port>`。

> 不假定存在 `webgal-terre preview` 这类 CLI 子命令。

---

## 6. 安全与合规（社区轻量基线）

* **路径沙箱**：拒绝绝对路径/`..` 跳出项目根；屏蔽 `.git/`、`node_modules/`、`.env` 等敏感目录。
* **命令白名单**：仅允许 `dev/build/lint` 等脚本（动态读取 `package.json`）；执行前需用户确认。
* **浏览器域限制**：仅 `http://localhost:*` / `http://127.0.0.1:*`。
* **写入必经 Diff 确认**；默认**不**外发遥测（可本地导出用量摘要）。
* **BYOK 提示**：密钥仅本地保存（会话/LocalStorage），提供“一键清除”。

---

## 7. 上下文管理与流式体验（建议）

* **上下文保护**：标记并优先保留包含“资源清单/角色注册/项目结构”的消息，避免被截断。
* **流式生成**：按“分号”切分为语句块，边流边展示，块内做快速校验（完整校验交给 MCP）。
* **预览去抖**：同一批生成结束后再预览，避免频繁刷新舞台。

---

## 8. 数据契约（工具 I/O 摘要）

* `list_files({ path }) → { entries: string[] }`（仅项目内路径）
* `read_file({ path, maxBytes? }) → { path, content }`
* `write_to_file({ path, content, mode: "overwrite"|"append", dryRun: boolean }) → { applied, diff?, snapshotId? }`
* `replace_in_file({ path, find, replace, flags? }) → { count }`
* `search_files({ path, regex, filePattern? }) → { matches: Array<{path,line,preview}> }`
* `execute_command({ scriptName }) → { ok, logs }`（**白名单脚本名**，如 `"dev"`）
* **MCP：`validate_script({ path }) → { valid, diagnostics[] }`**
* **MCP：`list_project_resources() → { backgrounds[], figures[], bgm[], scenes[] }`**
* （可选）**MCP：`preview_scene({ scenePath }) → { url, note }`**

> 诊断统一中文：`{ line, kind: "syntax"|"resource"|"style", message, fixHint? }`

---

## 9. 实施路线图（轻量、可渐进）

* **Phase 1（MVP）**

  * `<AgentPanel/>`（React）+ BYOK；
  * 只接：`list_files / read_file / write_to_file / replace_in_file / search_files / ask_followup_question / attempt_completion`；
  * 工作流：**计划 → 生成（仅展示/不落盘）**。

* **Phase 2（增强）**

  * 上 **MCP 校验器**：`validate_script`、`list_project_resources`；
  * 写入走 **Diff → 确认 → 落盘**；
  * 预览链路（Terre 或源码 dev）+ 浏览器自动化最小用例；
  * 流式展示与快照回滚。

* **Phase 3（完善）**

  * 上下文保护、一次自修复回路；
  * 截图回归、批量资源缺失提示；
  * （可选）极薄代理：密钥保护/多提供商回退。

---

## 10. 验收标准（可执行清单）

* [ ] 产生**有效脚本**（分号齐全、资源存在，`validate_script` 通过）。
* [ ] **Diff 确认**后写入成功，并可通过 `snapshotId` 回滚。
* [ ] 预览可打开本地地址并进入目标场景，无关键报错。
* [ ] 大段剧情能被**分场景生成**，每场景可单独预览/写入。
* [ ] 搜索/替换能在 `game/scene` 内批量执行且可撤销。
* [ ] 安全策略生效（白名单命令/路径沙箱/本地域限制）。

---

## 11. 风险与缓解

* **模型编造资源名** → 先 `list_project_resources`/`list_files`，`validate_script` 强校验，必要时自动建议最相近文件名。
* **预览端口/入口差异** → 通过读取 `package.json` 与用户选择来确定预览路径与端口。
* **并发写入冲突** → `write_to_file(dryRun)` 后在确认到落盘间校验文件哈希；冲突则提示“重读 → 重新出 Diff”。
* **上下文爆量** → “计划/脚本分离 + 分场景/分批 + 保护消息位点”。

---

### 一句话总结

**复用 Cline 的 70% 通用能力**（文件/交互/MCP/浏览器），**精确适配 30% WebGAL 特性**（DSL 校验、资源感知、预览耦合、安全沙箱）。默认零后端、可渐进增强，既保持社区轻量，又能在真实创作流程中“拉满闭环”。
