# @webgal-agent/agent-core

WebGAL Agent 核心工具包，提供文件操作、脚本校验、资源管理等功能。

## 功能特性

### 基础文件工具
- ✅ `list_files` - 列出文件/目录
- ✅ `read_file` - 读取文件
- ✅ `write_to_file` - 写入文件（支持 dry-run、diff、快照、幂等）
- ✅ `replace_in_file` - 文件内替换
- ✅ `search_files` - 搜索文件

### WebGAL 专用工具
- ✅ `validate_script` - 脚本校验（分号、指令、资源）
- ✅ `list_project_resources` - 列出项目资源
- ✅ `preview_scene` - 场景预览（需要 dev 模式）

### 交互工具
- ✅ `ask_followup_question` - 追问用户
- ✅ `attempt_completion` - 呈现完成结果

### 命令与浏览器（dev 模式）
- ✅ `execute_command` - 执行白名单命令
- ✅ `browser_action` - 浏览器动作（占位）

## 快速开始

```typescript
import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import { DEFAULT_SANDBOX_CONFIG } from '@webgal-agent/tool-bridge';

// 初始化工具
const tools = new WebGALAgentTools({
  projectRoot: '/path/to/webgal/project',
  sandbox: {
    ...DEFAULT_SANDBOX_CONFIG,
    projectRoot: '/path/to/webgal/project',
  },
  execution: {
    enabled: true,
    allowedCommands: ['dev', 'build', 'lint'],
    timeoutMs: 180000,
    workingDir: '.',
    redactEnv: ['API_KEY'],
  },
  browser: {
    enabled: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    screenshotDir: 'screenshots',
    timeoutMs: 30000,
  },
  snapshotRetention: 20,
});

// 使用工具
const resources = await tools.listProjectResources();
console.log('可用背景:', resources.backgrounds);
console.log('可用立绘:', resources.figures);
```

## 使用示例

### 1. 写入文件（带 Diff 确认）

```typescript
// 第一步：dry-run 获取 diff
const dryRunResult = await tools.writeToFile({
  path: 'game/scene/beach_date.txt',
  content: 'changeBg: beach.jpg -next;\n雪乃: 海风真舒服呢;\n',
  dryRun: true,
});

console.log('Diff:', dryRunResult.diff);

// 第二步：用户确认后实际写入
const writeResult = await tools.writeToFile({
  path: 'game/scene/beach_date.txt',
  content: 'changeBg: beach.jpg -next;\n雪乃: 海风真舒服呢;\n',
  dryRun: false,
  idempotencyKey: 'unique-key-123',
});

console.log('快照 ID:', writeResult.snapshotId);
```

### 2. 校验脚本

```typescript
const result = await tools.validateScript({
  path: 'game/scene/beach_date.txt',
});

if (!result.valid) {
  for (const diagnostic of result.diagnostics) {
    console.log(`行 ${diagnostic.line}: ${diagnostic.message}`);
    if (diagnostic.fixHint) {
      console.log(`  提示: ${diagnostic.fixHint}`);
    }
  }
}
```

### 3. 搜索文件

```typescript
const matches = await tools.searchFiles({
  path: 'game/scene',
  regex: '雪乃',
  filePattern: '**/*.txt',
  maxMatches: 100,
});

for (const match of matches.matches) {
  console.log(`${match.path}:${match.line} - ${match.preview}`);
}
```

### 4. 预览场景（dev 模式）

```typescript
const preview = await tools.previewScene({
  scenePath: 'game/scene/beach_date.txt',
});

console.log('预览 URL:', preview.url);
// 输出: http://localhost:3001#scene=beach_date
```

## 错误处理

所有工具都遵循统一的错误模型：

```typescript
try {
  await tools.writeToFile({ ... });
} catch (err) {
  const error = err as ToolError;
  console.error('错误码:', error.error.code);
  console.error('错误信息:', error.error.message);
  console.error('提示:', error.error.hint);
  console.error('可恢复:', error.error.recoverable);
}
```

### 常见错误码

- `E_NOT_FOUND` - 文件/目录不存在
- `E_DENY_PATH` - 路径越权
- `E_CONFLICT` - 并发冲突
- `E_TIMEOUT` - 超时
- `E_POLICY_VIOLATION` - 策略违规
- `E_BAD_ARGS` - 参数错误

## 安全特性

### 路径沙箱
- 仅允许项目根目录内的相对路径
- 禁止绝对路径和 `..` 越权
- 屏蔽 `.git`、`node_modules`、`.env` 等敏感目录

### 命令白名单
- 仅允许 `package.json` 中定义的 `dev`、`build`、`lint` 脚本
- 超时保护（默认 180 秒）
- 环境变量遮蔽

### 浏览器限制
- 仅允许 `localhost` 和 `127.0.0.1`
- 超时保护（默认 30 秒）

### 写入保护
- 强制 Diff 确认
- 原子写入（临时文件 + 重命名）
- 并发冲突检测
- 快照与回滚

## 快照管理

写入成功后会自动创建快照，保存在 `.webgal_agent/snapshots` 目录：

```
.webgal_agent/
  snapshots/
    snap_20251101T093210_ab12cd34.txt       # 内容
    snap_20251101T093210_ab12cd34.meta.json # 元数据
```

默认保留最近 20 个快照，可通过 `snapshotRetention` 配置。

## 开发与测试

```bash
# 运行测试
cd packages/testing
npm test

# 测试覆盖
# - write_to_file (dry-run, 实际写入, 幂等性, 冲突检测)
# - replace_in_file (替换计数)
# - validate_script (语法错误, 资源缺失)
# - list_project_resources (资源列表)
```

## 许可证

MIT

