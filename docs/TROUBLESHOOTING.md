# 故障排查（Troubleshooting）

> 本页汇总在 WebGAL Agent × Cline 联动中常见问题与快速修复建议。更多上下文见 `docs/CLINE_WEBGAL_INTEGRATION.md` 与 `QUICKSTART.md`。

## 1. 锁冲突（[LOCK] E_LOCK_HELD）
- 现象：Terre 端尝试启动 MCP 时，报错 `[LOCK] E_LOCK_HELD`。
- 原因：`.webgal_agent/agent.lock` 已被其他进程（如 Cline）持有，`owner != "terre"`。
- 处理：
  1) 在 Cline 停止该 MCP 进程或关闭工作区；
  2) 删除僵尸锁（仅在确认外部进程已退出的前提下），然后重试连接；
  3) 或在 Terre 前端切换到“外部 Cline”模式，以只读方式观测。
- 预防：同一项目根下，同一时刻仅让一端（Terre 或 Cline）持有锁。

## 2. 工具被禁用（E_TOOL_DISABLED）
- 现象：调用如 `execute_command`、`browser_action` 等报错 `E_TOOL_DISABLED`。
- 处理：
  - CLI 开关：在 MCP 启动参数中添加 `--enable-exec` 或 `--enable-browser`；
  - 或在 `policies.json` 打开对应能力（`enabled: true`）。
- 验证：使用 `get_runtime_info` 查看当前运行时中 execution/browser 是否开启。

## 3. 读取过大（E_TOO_LARGE）
- 现象：`read_file` 或 Dry‑run/Apply 时提示内容超出最大读取限制。
- 处理：
  1) 将大文件拆分；或在参数中使用更小的 `maxBytes`；
  2) 提升 `sandbox.maxReadBytes`（CLI 或策略均可）；
  3) 用 `get_runtime_info` 核对当前限制与文本编码。

## 4. 策略未生效
- 现象：修改了 `policies.json` 但功能未按预期启用/禁用。
- 处理：
  1) 用 `get_runtime_info` 核对 `policiesPath` 与已生效的字段；
  2) 确认路径正确、JSON 语法有效；
  3) 重启 MCP；必要时在 CLI 加 `--verbose` 检查 `[POLICY]` 输出。

## 5. 外部 Cline 模式下无法 Apply
- 说明：为避免 Terre 与 Cline 并发写入产生竞态，外部 Cline 模式在前端禁用 “确认恢复（Apply）”。
- 处理：
  - 需要在 Terre 中回滚/写入时，切回“Terre 托管”模式并确保无外部锁；
  - 或改在 Cline 侧执行回滚流程（`list_snapshots → restore_snapshot → write_to_file(dryRun:true/false)`）。

## 6. 并发导致 UI 状态错乱
- 现象：快速切换快照或刷新后出现旧 Diff 覆盖新选择、选中项消失等。
- 对策（已内建）：
  - 通过 `opToken` 与 `listRevision` 避免旧请求结果污染；
  - 列表刷新后会校验“选中项仍存在”，否则清空并提示；
  - 操作进行中（生成 Diff/应用中）会临时禁用切换。

---

参考：更完整的 Cline 接入说明与模板见 `docs/CLINE_WEBGAL_INTEGRATION.md`。
