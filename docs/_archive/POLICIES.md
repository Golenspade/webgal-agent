# POLICIES.md — 护栏与策略（本地运行 · act2plan）

> 目的：用一份清晰的“护栏与策略”文档，约束代理在本地 WebGAL 项目中的行为，确保**可控、可审、可回滚**。  
> 范畴：**不改架构**（沿用 Cline 的 Plan→Act 循环），**纯本地**（文件与预览都在本机），联网仅用于 **LLM API** 与项目必要的 fetch。  
> 运行形态：默认 **用户模式（Terre 一键启动）**；可选 **开发者模式（源码 dev）**。

---

## 1. 模式（Modes）

- **用户模式（Terre）**
  - 入口：用户在 Terre 中打开本项目的 Agent 面板。
  - 特性：不执行任何本地命令；仅进行文件读写、校验、预览（由 Terre 提供）。

- **开发者模式（源码 dev）**
  - 入口：本地起引擎/预览（如 `yarn dev`），再启动 Agent 面板。
  - 特性：允许执行白名单命令（`dev/build/lint`），允许最小浏览器动作（本地域）。

> 两种模式共用同一套工具与约束。差异仅在“命令与浏览器”是否启用。

---

## 2. 配置文件（示例）

将下列 JSON 存为 `configs/policies.json`，或通过 UI 编辑。

```json
{
  "mode": "cline",
  "sandbox": {
    "root": "${projectRoot}",
    "forbiddenDirs": [".git", "node_modules", ".env"],
    "maxReadBytes": 1048576,
    "textEncoding": "utf-8"
  },
  "writes": {
    "requireDiff": true,
    "idempotency": true,
    "newline": "preserve",
    "atomicWrite": true,
    "conflictStrategy": "fail",   // fail | overwrite-with-snapshot
    "snapshotRetention": 20
  },
  "execution": {
    "enabled": false,
    "allowedCommands": ["dev", "build", "lint"],
    "timeoutMs": 180000,
    "workingDir": ".",
    "redactEnv": ["API_KEY", "TOKEN"]
  },
  "browser": {
    "enabled": false,
    "allowedHosts": ["localhost", "127.0.0.1"],
    "screenshotDir": "test-screenshots",
    "timeoutMs": 30000
  },
  "models": {
    "provider": "anthropic|openai|qwen|deepseek",
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.4,
    "maxTokens": 4000,
    "truncate": {
      "strategy": "preserve-protected",
      "protectedMarkers": ["## 可用背景", "## 可用立绘", "register:", "label:"]
    }
  },
  "hooks": {
    "beforeActBatch": [
      "list_project_resources",
      "read_file:game/scene/start.txt?optional=true"
    ],
    "reorientOn": ["E_RESOURCE_MISSING", "E_PREVIEW_FAIL"]
  },
  "limits": {
    "batchMaxLines": 2000,
    "maxAutoFix": 1,
    "rateLimit": { "rpm": 30, "burst": 10 }
  },
  "network": {
    "llmOnly": true,
    "outboundAllowList": ["api.anthropic.com", "api.openai.com"]
  },
  "telemetry": {
    "enabled": false,
    "localLogs": true,
    "logLevel": "info"
  }
}
```

> **用户模式默认值**：`execution.enabled=false`、`browser.enabled=false`。  
> **开发者模式建议**：按需将 `execution.enabled`/`browser.enabled` 设为 `true`。

---

## 3. 路径沙箱（Sandbox）

- **根目录**：所有相对路径都以用户选定的项目根 `${projectRoot}` 为基准。  
- **禁止项**：绝对路径、`..` 越权、`forbiddenDirs` 目录下的文件。  
- **编码**：统一以 UTF‑8 读写；`maxReadBytes` 超限时返回 `E_TOO_LARGE`。  
- **安全提示**：不要读取或写入存放密钥的文件（如 `.env`）。

实现要点：路径规范化（`resolve`）后再检查是否以 `projectRoot` 开头。

---

## 4. 写入策略（Writes）

- **必须 Diff**：写入前先 `dryRun=true` 获取结构化 Diff，UI 确认后再落盘。  
- **幂等**：同一 `idempotencyKey` + 相同内容 → 二次提交无副作用。  
- **原子写**：先写临时文件再替换，避免中途中断造成损坏。  
- **换行**：`newline` 可设为 `preserve | lf | crlf`。默认保持原文件风格。  
- **冲突**：当目标文件在 diff 后被外部修改 → 返回 `E_CONFLICT`。策略 `fail / overwrite-with-snapshot` 由配置决定。  
- **快照**：成功写入返回 `snapshotId`，保留最近 `snapshotRetention` 个，用于回滚。

---

## 5. 命令与浏览器（仅开发者模式）

### 5.1 命令（execute_command）
- 仅允许 `allowedCommands` 中的脚本名（从目标项目 `package.json` 收集）。
- 单次最长执行 `timeoutMs`。超时返回 `E_TIMEOUT`。
- 不透传敏感环境变量；按 `redactEnv` 列表遮蔽日志。

### 5.2 浏览器（browser_action）
- 仅允许 `allowedHosts`（`localhost` / `127.0.0.1`）。
- 常用动作：`open`、`click`、`screenshot`。截图保存于 `screenshotDir`。  
- 单步最长等待 `timeoutMs`。超时返回 `E_TIMEOUT`。

---

## 6. 预览策略（Preview）

- **用户模式**：交给 Terre 的预览页（通常 `http://localhost:<port>`）。
- **开发者模式**：指向本地 dev 端口。  
- 失败处理：
  1. 检查入口场景是否设置正确。
  2. 如脚本校验未通过，先修复再试。
  3. 仍失败 → 报告并等待用户选择（改脚本/替代资源/稍后重试）。

---

## 7. 模型与上下文（Models & Context）

- **温度**：默认 0.4，追求稳定与可复现。  
- **截断**：在需要截断上下文时，优先保留“受保护片段”（资源清单、label 索引等）。  
- **流式**：需要时可启用流式生成；但落盘前仍需完整校验与 Diff。

---

## 8. 钩子（Hooks）

- `beforeActBatch`：在一批生成动作前执行
  - 同步资源：`list_project_resources`
  - 读取入口场景（可选）：`read_file:game/scene/start.txt`
- `reorientOn`：触发重新定位或询问用户的错误码集合
  - `E_RESOURCE_MISSING`、`E_PREVIEW_FAIL` 等

---

## 9. 失败与自修（Failures & AutoFix）

- **自修上限**：`maxAutoFix=1`。一次修复后仍失败 → 暂停并请用户决策。  
- **修复范围**：仅修改导致失败的局部行；不大幅重写已通过的部分。  
- **错误分类**：
  - 语法类（分号、顺序、未知指令）
  - 资源类（文件不存在、路径错误）
  - 预览类（入口/加载失败）

---

## 10. 网络边界（Network）

- **llmOnly=true**：工具层不访问外网；联网仅由 LLM API 调用完成。  
- **出站白名单**：可选限制到特定域（如 `api.anthropic.com`、`api.openai.com`）。  
- **日志**：不记录请求/响应正文；只保留最小化 metainfo（时长、状态）。

---

## 11. 日志与隐私（Telemetry & Privacy）

- **默认无遥测**：`telemetry.enabled=false`。  
- **本地日志**：`localLogs=true`，仅本机查看。  
- **日志级别**：`info`，必要时调到 `debug` 进行本地排障。  
- **隐私**：不上传用户项目文件；不含任何远端文件系统访问。

---

## 12. 默认值与理由

| 项 | 默认值 | 理由 |
|---|---|---|
| `requireDiff` | `true` | 避免误写入，形成“可审、可回滚”的流程 |
| `idempotency` | `true` | 防止重复提交写入两次 |
| `maxAutoFix` | `1` | 控制回路复杂度，避免无限修复 |
| `batchMaxLines` | `2000` | 防止生成过长导致校验/预览失败 |
| `allowedHosts` | `localhost/127.0.0.1` | 约束本地预览，不出网 |
| `allowedCommands` | `dev/build/lint` | 只允许最常用且可控的脚本 |
| `atomicWrite` | `true` | 避免中断写入造成损坏 |

---

## 13. 常见策略变体（模板）

### 13.1 仅 Terre（用户模式，最稳）
```json
{
  "execution": { "enabled": false },
  "browser": { "enabled": false }
}
```

### 13.2 教学/演示（允许自动预览截图）
```json
{
  "browser": { "enabled": true, "screenshotDir": "test-screenshots" }
}
```

### 13.3 团队项目（更保守写入）
```json
{
  "writes": {
    "requireDiff": true,
    "conflictStrategy": "fail",
    "snapshotRetention": 50
  }
}
```

---

## 14. 验收要点（与 TESTING.md 对应）

- 写入前必有 Diff；写入后返回 `snapshotId`，可回滚。  
- `validate_script` 通过；预览可进入目标场景。  
- 资源缺失时提供清单与替代建议。  
- 开发者模式下，命令与浏览器限制生效（白名单、本地域名、超时）。

---

（完）
