# Cline 集成与 WebGAL 适配指南

本指南帮助你将本项目（mcp-webgal）作为 MCP Server 接入 Cline，并通过规则/工作流让 Cline 按照 WebGAL 的最佳实践安全地调用工具。

## 一、接入 Cline（stdio）

在 Cline 的 MCP 设置中新增一个服务器（可通过 UI 或直接编辑 `cline_mcp_settings.json`）：

示例（开发模式，TS 源码）
```
{
  "mcpServers": {
    "webgal-agent": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--import", "tsx",
        "/abs/path/to/webgal_agent/packages/mcp-webgal/src/bin.ts",
        "--project", "/abs/path/to/your-webgal-project",
        "--policies", "/abs/path/to/your-policies.json"
      ],
      "cwd": "/abs/path/to/your-webgal-project",
      "timeout": 60,
      "autoApprove": [
        "list_files",
        "read_file",
        "search_files"
      ]
    }
  }
}
```

示例（生产模式，使用构建产物 `dist/bin.js`）
```
{
  "mcpServers": {
    "webgal-agent": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/abs/path/to/webgal_agent/packages/mcp-webgal/dist/bin.js",
        "--project", "/abs/path/to/your-webgal-project",
        "--policies", "/abs/path/to/your-policies.json"
      ],
      "cwd": "/abs/path/to/your-webgal-project",
      "timeout": 60,
      "autoApprove": ["list_files", "read_file", "search_files"]
    }
  }
}
```

可选能力开关
- 启用命令执行：在 args 添加 `--enable-exec`，或在 `policies.json` 中 `execution.enabled: true`
- 启用浏览器动作：在 args 添加 `--enable-browser`，仅允许 `localhost/127.0.0.1`

注意
- 建议不要对 `write_to_file / replace_in_file / execute_command` 做 autoApprove，保持手动批准。
- 同一项目根不要同时由 Cline 与 Terre 各自拉起 MCP，以免产生并发写入风险（可在团队约定中明确单一启动方）。

## 二、WebGAL 规则（.clinerules 模板）

将以下规则加入你的项目规则中（例如 `Documents/Cline/Rules/webgal-rules.md`）：

```
# WebGAL 编辑规则

- 作用域：仅编辑 `game/**` 文本资源。
- 禁止：`.webgal_agent/**`、`.git/**`、`node_modules/**`。
- 小改动优先 `replace_in_file`；全量重写/新建用 `write_to_file`。
- 始终：先 `write_to_file(dryRun: true)` 预览 Diff，用户批准后再 `dryRun: false`。
- 变更后：使用 `validate_script` 校验；如需浏览，用 `preview_scene` 获取 URL。
- 回滚：`list_snapshots`→选择→`restore_snapshot`→`write_to_file(dryRun:true/false)`。
- 错误处理：
  - `E_CONFLICT`：`read_file` 获取最新内容后重新 Dry‑run。
  - `E_TOOL_DISABLED`：提示在 `policies.json` 中启用对应能力。
  - `E_TOO_LARGE`：提示提升 `sandbox.maxReadBytes`，可由 `get_runtime_info` 查看当前限制。
```

## 三、工作流模板（.clinerules/workflows）

1) 场景小改动
```
目标：对 `game/scene/<name>.txt` 做局部修改

步骤：
- list_files('game/scene') 收集候选
- read_file 读取目标文件
- 构思修改（尽量仅变动必要行）
- replace_in_file（一次尽量 <5 处，必要时多轮）
- validate_script 检查
- write_to_file(dryRun:true) 预览
- 用户批准后 write_to_file(dryRun:false)
- 记录返回的 snapshotId
```

2) 场景全量重写/新建
```
目标：重写/新建 `game/scene/<name>.txt`

步骤：
- 构思完整稿
- write_to_file(dryRun:true) 预览全文 Diff
- 用户批准后 write_to_file(dryRun:false)
- validate_script 检查
- 记录 snapshotId
```

3) 快照回滚
```
目标：回滚指定文件到历史版本

步骤：
- list_snapshots({ path: 'game/scene' })
- 选择 snapshotId
- restore_snapshot({ snapshotId }) → 返回 { path, content }
- write_to_file({ path, content, dryRun:true }) 预览
- 用户批准后 write_to_file({ path, content, dryRun:false })
- 记录新 snapshotId
```

## 四、运行环境与策略可见性

可用 `get_runtime_info` 查询当前 MCP 进程的策略与能力（retention、sandbox、exec/browser、工具清单）。建议在任务开始时先调用一次，以便选择合适的工具与操作策略。

## 五、常见问题

- 同项目同时由 Cline 与 Terre 启动 MCP？
  - 不建议。请选择单一启动方（Cline 或 Terre）。另一端可只作为观察/回滚工具。
- `E_TOOL_DISABLED`？
  - 在 CLI 增加 `--enable-exec/--enable-browser`，或在 `policies.json` 启用对应能力。
- `E_TOO_LARGE` 读取限制？
  - 提升 `sandbox.maxReadBytes`。用 `get_runtime_info` 查看当前限制。

