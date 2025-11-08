# WebGAL Agent 快速开始

## 前置要求

- Node.js >= 18
- pnpm (推荐) 或 npm

## 安装依赖

```bash
# 在项目根目录
pnpm install

# 或使用 npm
npm install
```

## 运行测试

```bash
# 进入测试包
cd packages/testing

# 运行测试
pnpm test

# 或使用 npm
npm test
```

## 使用示例

### 1. 基础使用

```typescript
import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import { DEFAULT_SANDBOX_CONFIG } from '@webgal-agent/tool-bridge';

// 初始化工具（指向你的 WebGAL 项目）
const tools = new WebGALAgentTools({
  projectRoot: '/path/to/your/webgal/project',
  sandbox: {
    ...DEFAULT_SANDBOX_CONFIG,
    projectRoot: '/path/to/your/webgal/project',
  },
  execution: {
    enabled: true,
    allowedCommands: ['dev', 'build', 'lint'],
    timeoutMs: 180000,
    workingDir: '.',
    redactEnv: ['API_KEY'],
  },
  snapshotRetention: 20,
});
```

### 2. 列出项目资源

```typescript
const resources = await tools.listProjectResources();

console.log('可用背景:', resources.backgrounds);
// ['beach.jpg', 'classroom.png', ...]

console.log('可用立绘:', resources.figures);
// ['yukino.png', 'yui.png', ...]

console.log('可用 BGM:', resources.bgm);
// ['beach_bgm.mp3', 'sad_bgm.ogg', ...]

console.log('可用场景:', resources.scenes);
// ['start.txt', 'beach_date.txt', ...]
```

### 3. 校验脚本

```typescript
const result = await tools.validateScript({
  content: `
changeBg: beach.jpg -next;
雪乃: 海风真舒服呢;
changeFigure: yukino.png -next;
雪乃: 你也这么觉得吗？;
  `.trim(),
});

if (result.valid) {
  console.log('✅ 脚本校验通过');
} else {
  console.log('❌ 脚本有问题:');
  for (const diagnostic of result.diagnostics) {
    console.log(`  行 ${diagnostic.line}: ${diagnostic.message}`);
    if (diagnostic.fixHint) {
      console.log(`    提示: ${diagnostic.fixHint}`);
    }
  }
}
```

### 4. 写入文件（带 Diff 确认）

```typescript
const content = `
changeBg: beach.jpg -next;
雪乃: 海风真舒服呢;
changeFigure: yukino.png -next;
雪乃: 你也这么觉得吗？;
`.trim();

// 第一步：dry-run 获取 diff
const dryRunResult = await tools.writeToFile({
  path: 'game/scene/beach_date.txt',
  content,
  dryRun: true,
});

console.log('📝 Diff 预览:');
if (dryRunResult.diff) {
  for (const hunk of dryRunResult.diff.hunks) {
    console.log(`@@ -${hunk.startOld},${hunk.lenOld} +${hunk.startNew},${hunk.lenNew} @@`);
    console.log('- ' + hunk.linesOld.join('\n- '));
    console.log('+ ' + hunk.linesNew.join('\n+ '));
  }
}

// 第二步：用户确认后实际写入
const writeResult = await tools.writeToFile({
  path: 'game/scene/beach_date.txt',
  content,
  dryRun: false,
  idempotencyKey: 'beach-date-v1',
});

console.log('✅ 写入成功');
console.log('快照 ID:', writeResult.snapshotId);
console.log('写入字节:', writeResult.bytesWritten);
```

### 5. 搜索文件

```typescript
const matches = await tools.searchFiles({
  path: 'game/scene',
  regex: '雪乃',
  filePattern: '**/*.txt',
  maxMatches: 100,
});

console.log(`找到 ${matches.totalMatches} 处匹配:`);
for (const match of matches.matches) {
  console.log(`${match.path}:${match.line} - ${match.preview}`);
}
```

### 6. 预览场景（需要 dev 模式）

```typescript
const preview = await tools.previewScene({
  scenePath: 'game/scene/beach_date.txt',
});

console.log('🌐 预览 URL:', preview.url);
// 输出: http://localhost:3001#scene=beach_date

console.log('📋 启动日志:');
for (const log of preview.logs) {
  console.log('  ', log);
}
```

## 错误处理

所有工具都遵循统一的错误模型：

```typescript
try {
  await tools.writeToFile({ ... });
} catch (err) {
  const error = err as any;

  console.error('错误码:', error.error.code);
  console.error('错误信息:', error.error.message);

  if (error.error.hint) {
    console.error('提示:', error.error.hint);
  }

  if (error.error.recoverable) {
    console.log('这是一个可恢复的错误，可以重试');
  }
}
```

### 常见错误码

| 错误码 | 说明 | 可恢复 |
|--------|------|--------|
| `E_NOT_FOUND` | 文件/目录不存在 | ✅ |
| `E_DENY_PATH` | 路径越权（试图访问项目外或禁止目录） | ❌ |
| `E_CONFLICT` | 并发冲突（文件在 dry-run 后被修改） | ✅ |
| `E_TIMEOUT` | 操作超时 | ✅ |
| `E_POLICY_VIOLATION` | 策略违规（如执行非白名单命令） | ❌ |
| `E_BAD_ARGS` | 参数错误 | ✅ |
| `E_PREVIEW_FAIL` | 预览失败 | ✅ |

## 快照管理

写入成功后会自动创建快照，保存在 `.webgal_agent/snapshots` 目录：

```
.webgal_agent/
  snapshots/
    snap_20251101T093210_ab12cd34.txt       # 内容快照
    snap_20251101T093210_ab12cd34.meta.json # 元数据
```

快照元数据示例：

```json
{
  "snapshotId": "snap_20251101T093210_ab12cd34",
  "path": "game/scene/beach_date.txt",
  "timestamp": "2025-11-01T09:32:10.123Z",
  "idempotencyKey": "beach-date-v1",
  "hash": "sha256:abc123..."
}
```

默认保留最近 20 个快照，可通过配置调整。

## 配置文件

默认配置位于 `configs/policies.json`，可以根据需要调整：

```json
{
  "sandbox": {
    "root": "${projectRoot}",
    "forbiddenDirs": [".git", "node_modules", ".env"],
    "maxReadBytes": 1048576
  },
  "writes": {
    "requireDiff": true,
    "idempotency": true,
    "snapshotRetention": 20
  },
  "execution": {
    "enabled": true,
    "allowedCommands": ["dev", "build", "lint"],
    "timeoutMs": 180000
  },
  "browser": {
    "enabled": true,
    "allowedHosts": ["localhost", "127.0.0.1"],
    "timeoutMs": 30000
  }
}
```

## 下一步

- 查看 [CONTRACTS.md](docs/CONTRACTS.md) 了解完整的工具规范
- 查看 [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) 了解实现状态
- 查看 [packages/agent-core/README.md](packages/agent-core/README.md) 了解更多 API 细节
- 运行测试了解更多使用示例

## 与 Cline 集成（推荐）

你可以直接在 Cline 中把本项目作为 MCP 服务器接入，这样就能用 Cline 的 Chat（Plan→Act）来调用本工具集完成 WebGAL 的自动化编辑。

步骤（stdio 方式）
- 在 Cline 的 MCP 设置里新增一个服务器：
  - `type: "stdio"`
  - `command: "node"`
  - `args`: 指向本仓库的 MCP 入口与项目根，例如：
    - 开发（TS 源码）: `--import tsx <repo>/packages/mcp-webgal/src/bin.ts --project <你的WebGAL项目根> --policies <policies.json>`
    - 生产（构建产物）: `<repo>/packages/mcp-webgal/dist/bin.js --project <你的WebGAL项目根> --policies <policies.json>`
  - `cwd`: `<你的WebGAL项目根>`
- 建议仅对 `list_files`、`read_file`、`search_files` 做 autoApprove；`write_to_file` / `replace_in_file` / `execute_command` 保持手动批准。
- 如需启用命令执行或浏览器能力：
  - CLI 开关：`--enable-exec` / `--enable-browser`
  - 或在 `policies.json` 打开对应 `enabled` 字段。


### 运行模式与锁机制
- Terre 托管：在 Terre 面板点击“连接”由后端托管 MCP。启动前会检查 `.webgal_agent/agent.lock`，若被外部进程（如 Cline）占用，将以 `[LOCK] E_LOCK_HELD` 拒绝启动。
- 外部 Cline：由 Cline 启动 MCP，Terre 面板切换到“外部 Cline”模式后仅做只读观测：可浏览快照与预览 Diff，但禁用 Apply（避免与 Cline 并发写入）。
- 建议：同一时刻仅一端持有锁。若需在 Terre 里进行回滚/写入，请先停止 Cline 或切回“Terre 托管”模式。

### 项目规则（.clinerules）
- 在项目根创建 `.clinerules/` 目录或 `.clinerules` 单文件，放置团队规则（Markdown）以指导 Cline 的行为。
- 本仓库提供示例规则（可复制到你的项目）：根目录的 `.clinerules/` 与 `cline/.clinerules/`。
- 常见约定：仅编辑 `game/**` 文本；先 Dry‑run 预览 Diff，获批再 Apply；变更后 `validate_script`；回滚使用 `list_snapshots/restore_snapshot`。

更多：详见 `docs/CLINE_WEBGAL_INTEGRATION.md` 与 `docs/TROUBLESHOOTING.md`。

WebGAL 使用规范（给 Cline 的提示）
- 小改优先 `replace_in_file`；全量重写/新建用 `write_to_file`。
- 始终先 `write_to_file(dryRun: true)` 预览，再在用户批准后 `dryRun: false` 应用。
- 修改脚本后用 `validate_script` 校验；需要时用 `preview_scene` 获取预览 URL。
- 回滚：`list_snapshots` → 选择 → `restore_snapshot` → `write_to_file(dryRun:true/false)`。
- 仅编辑 `game/**` 文本文件；不要改动 `.webgal_agent/**`、`.git/**`、`node_modules/**`。
- 错误处理建议：
  - `E_CONFLICT`: 先 `read_file` 取最新，再重做 Dry‑run。
  - `E_TOOL_DISABLED`: 提醒在 policies 中开启对应能力。
  - `E_TOO_LARGE`: 提示提升 `sandbox.maxReadBytes`（可通过 `get_runtime_info` 查看当前限制）。

更多细节与可复制模板，见 `docs/CLINE_WEBGAL_INTEGRATION.md`。

## 常见问题

### Q: 如何回滚到之前的版本？

A: 快照系统已实现，但回滚功能待实现。可以手动从 `.webgal_agent/snapshots` 目录恢复。

### Q: 可以在生产环境使用吗？

A: 当前是 MVP 版本，建议仅在开发环境使用。生产环境需要更严格的测试和安全审计。

### Q: 如何添加自定义命令到白名单？

A: 在项目的 `package.json` 中添加脚本，工具会自动收集。但只有 `dev`、`build`、`lint` 会被允许执行。

### Q: 浏览器自动化功能可用吗？

A: 当前是占位实现，需要集成 Playwright 等库才能真正使用。
