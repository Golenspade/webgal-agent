
---

# CONTRACTS.md — Tool Contracts (Local-Only, Cline Plan→Act)

> **目的**：定义 WebGAL Agent 使用的全部工具（Tools）契约：**入参/出参 JSON Schema、错误模型、语义与约束、示例与边界**。
> **架构前提**：沿用 **Cline Plan→Act** 循环；本项目 **纯本地**（文件/预览都在本机），联网仅用于 **LLM API** 与 Cline 必要的 `fetch`。
> **适用范围**：Terre 用户模式（推荐）与源码 dev 的开发者模式（仅在开发者模式开放命令/浏览器工具，并受白名单/本地域限制）。

---

## 0. 全局约定

### 0.1 版本

* `contractVersion`: `"1.0.0"`（如将来变更字段语义或必填项，**提升次版本号**）

### 0.2 统一错误模型

所有工具失败时返回统一结构（或在异常中携带同结构）：

```json
{
  "error": {
    "code": "E_NOT_FOUND",
    "message": "File not found: game/scene/foo.txt",
    "details": { "path": "game/scene/foo.txt" },
    "hint": "Check the scene name or run list_files on game/scene.",
    "recoverable": true
  }
}
```

**错误码枚举**

* 访问/路径：`E_DENY_PATH`（越权/越根）、`E_NOT_FOUND`、`E_IO`、`E_TOO_LARGE`
* 内容/解析：`E_ENCODING`、`E_PARSE_FAIL`、`E_LINT_FAIL`
* 写入/并发：`E_CONFLICT`（内容已变/锁冲突）
* 预览/运行：`E_PREVIEW_FAIL`、`E_TIMEOUT`
* 策略/能力：`E_POLICY_VIOLATION`（不允许操作）、`E_TOOL_DISABLED`、`E_UNSUPPORTED`
* 参数：`E_BAD_ARGS`
* 其他：`E_INTERNAL`

### 0.3 路径与沙箱

* **相对路径**均以“用户选定的 WebGAL 项目根”作为根目录（`projectRoot`）。
* 禁止绝对路径、禁止 `..` 越权；默认屏蔽目录：`.git/`, `node_modules/`, `.env/`。
* 仅在 **开发者模式** 才可使用 `execute_command` 与 `browser_action`，并受策略约束。

### 0.4 写入与 Diff、快照与幂等

* **强制 Diff**：`write_to_file` 必须先以 `dryRun: true` 预演，UI 确认后再 `dryRun: false` 落盘。
* **Diff 结构**（JSON，不用 unified-diff 文本，便于渲染与回滚）：

```json
{
  "type": "line",
  "hunks": [
    { "startOld": 12, "lenOld": 3, "startNew": 12, "lenNew": 4,
      "linesOld": ["A", "B", "C"], "linesNew": ["A", "B1", "B2", "C"] }
  ]
}
```

* **快照**：成功写入返回 `snapshotId`（`"snap_YYYYMMDDThhmmss_<8hex>"`），用于回滚。
* **幂等**：可选 `idempotencyKey`（由调用方生成，建议 UUIDv4），相同 key 的重复提交在同一文件同一内容下**不重复写入**。

### 0.5 网络与命令策略

* **网络**：工具层 **不进行任何外网访问**。联网仅由 LLM API 与 Cline 必要的 `fetch` 进行。
* **命令白名单**：`execute_command` 仅允许 `package.json` 中出现的 `"dev"|"build"|"lint"` 等脚本名。
* **浏览器白名单**：仅允许 `http://localhost:*` / `http://127.0.0.1:*`。

---

## 1. 基础文件 & 检索工具

### 1.1 `list_files`

**用途**：列出相对路径下的文件/目录（项目根内）

**Request Schema**

```json
{
  "$id": "list_files.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "path": { "type": "string", "minLength": 1, "description": "Relative to projectRoot" },
    "globs": {
      "type": "array", "items": { "type": "string" },
      "description": "Optional include patterns, e.g. ['**/*.txt']"
    },
    "dirsOnly": { "type": "boolean", "default": false }
  },
  "required": ["path"]
}
```

**Response Schema**

```json
{
  "$id": "list_files.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "entries": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["entries"],
  "additionalProperties": false
}
```

**可能错误**：`E_DENY_PATH`, `E_NOT_FOUND`, `E_IO`

**示例**

```json
{"path":"game/scene","globs":["**/*.txt"]}
→
{"entries":["start.txt","chapter1.txt","ending.txt"]}
```

---

### 1.2 `read_file`

**用途**：读取文本文件

**Request**

```json
{
  "$id": "read_file.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object","additionalProperties": false,
  "properties": {
    "path": { "type": "string", "minLength": 1 },
    "maxBytes": { "type": "integer", "minimum": 1 }
  },
  "required": ["path"]
}
```

**Response**

```json
{
  "$id": "read_file.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object","additionalProperties": false,
  "properties": {
    "path": { "type": "string" },
    "content": { "type": "string" },
    "encoding": { "type": "string", "enum":["utf-8"], "default":"utf-8" },
    "bytes": { "type": "integer", "minimum": 0 }
  },
  "required": ["path","content"]
}
```

**可能错误**：`E_DENY_PATH`, `E_NOT_FOUND`, `E_ENCODING`, `E_TOO_LARGE`, `E_IO`

---

### 1.3 `write_to_file`

**用途**：写/改文本文件，支持 dry-run 出 Diff

**Request**

```json
{
  "$id": "write_to_file.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object","additionalProperties": false,
  "properties": {
    "path": { "type": "string", "minLength": 1 },
    "content": { "type": "string", "description": "New full content (overwrite) or appended chunk" },
    "mode": { "type": "string", "enum": ["overwrite","append"], "default":"overwrite" },
    "dryRun": { "type": "boolean", "default": true },
    "idempotencyKey": { "type": "string" }
  },
  "required": ["path","content","dryRun"]
}
```

**Response**

```json
{
  "$id": "write_to_file.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties": {
    "applied": { "type":"boolean" },
    "diff": {
      "type": "object",
      "properties": {
        "type": { "type":"string","const":"line" },
        "hunks": {
          "type":"array",
          "items":{
            "type":"object","additionalProperties": false,
            "properties":{
              "startOld":{"type":"integer","minimum":1},
              "lenOld":{"type":"integer","minimum":0},
              "startNew":{"type":"integer","minimum":1},
              "lenNew":{"type":"integer","minimum":0},
              "linesOld":{"type":"array","items":{"type":"string"}},
              "linesNew":{"type":"array","items":{"type":"string"}}
            },
            "required":["startOld","lenOld","startNew","lenNew","linesOld","linesNew"]
          }
        }
      },
      "required":["type","hunks"]
    },
    "snapshotId": { "type": "string" },
    "bytesWritten": { "type":"integer","minimum":0 }
  },
  "required": ["applied"]
}
```

**规则**

* `dryRun: true` → 必须返回 `diff`，`applied=false`
* `dryRun: false` → 成功返回 `applied=true` 与 `snapshotId`

**可能错误**：`E_DENY_PATH`, `E_CONFLICT`, `E_ENCODING`, `E_IO`, `E_POLICY_VIOLATION`

**示例**

```json
// 预演
{"path":"game/scene/start.txt","content":"…新全文…","mode":"overwrite","dryRun":true}
→ {"applied":false,"diff":{...}}

// 确认后写入
{"path":"game/scene/start.txt","content":"…新全文…","mode":"overwrite","dryRun":false,"idempotencyKey":"b3c4…"}
→ {"applied":true,"snapshotId":"snap_20251101T093210_ab12cd34","bytesWritten":1024}
```

---

### 1.4 `replace_in_file`

**用途**：在单文件内进行安全的字符串/正则替换（比“读→改→全覆盖”更稳）

**Request**

```json
{
  "$id": "replace_in_file.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "path":{"type":"string"},
    "find":{"type":"string","description":"String or JS-style regex literal e.g. (?m)^hello$"},
    "replace":{"type":"string"},
    "flags":{"type":"string","description":"Regex flags, if regex used"}
  },
  "required":["path","find","replace"]
}
```

**Response**

```json
{
  "$id": "replace_in_file.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{"count":{"type":"integer","minimum":0}},
  "required":["count"]
}
```

**可能错误**：同 `write_to_file` + `E_BAD_ARGS`（非法正则）

---

### 1.5 `search_files`

**用途**：在目录下按正则搜索，支持 `filePattern` 过滤

**Request**

```json
{
  "$id": "search_files.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "path":{"type":"string"},
    "regex":{"type":"string"},
    "filePattern":{"type":"string","description":"glob, e.g. **/*.txt"},
    "maxMatches":{"type":"integer","minimum":1,"default":2000}
  },
  "required":["path","regex"]
}
```

**Response**

```json
{
  "$id":"search_files.response",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "matches":{
      "type":"array",
      "items":{
        "type":"object","additionalProperties": false,
        "properties":{
          "path":{"type":"string"},
          "line":{"type":"integer","minimum":1},
          "preview":{"type":"string"}
        },
        "required":["path","line","preview"]
      }
    }
  },
  "required":["matches"]
}
```

---

## 2. WebGAL 专用工具（本地；建议 MCP 化）

### 2.1 `list_project_resources`

**用途**：聚合 WebGAL 项目资源一览

**Response**

```json
{
  "$id":"list_project_resources.response",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "backgrounds":{"type":"array","items":{"type":"string"}},
    "figures":{"type":"array","items":{"type":"string"}},
    "bgm":{"type":"array","items":{"type":"string"}},
    "vocals":{"type":"array","items":{"type":"string"}},
    "scenes":{"type":"array","items":{"type":"string"}}
  },
  "required":["backgrounds","figures","bgm","vocals","scenes"]
}
```

---

### 2.2 `validate_script`

**用途**：校验脚本语法与资源引用（分号、未知指令、文件存在）

**Request**

```json
{
  "$id":"validate_script.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "path":{"type":"string"},
    "content":{"type":"string"}
  },
  "oneOf":[
    {"required":["path"]},
    {"required":["content"]}
  ]
}
```

**Response**

```json
{
  "$id":"validate_script.response",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "valid":{"type":"boolean"},
    "diagnostics":{
      "type":"array",
      "items":{
        "type":"object","additionalProperties": false,
        "properties":{
          "line":{"type":"integer","minimum":1},
          "kind":{"type":"string","enum":["syntax","resource","style"]},
          "message":{"type":"string"},
          "fixHint":{"type":"string"}
        },
        "required":["line","kind","message"]
      }
    }
  },
  "required":["valid","diagnostics"]
}
```

**可能错误**：`E_PARSE_FAIL`, `E_LINT_FAIL`, `E_NOT_FOUND`

---

### 2.3 `preview_scene`

**用途**：将预览入口指向目标场景并打开本地预览
**说明**：Terre 用户模式优先；源码 dev 方式则指向本地 dev 端口。**仅本地域名**。

**Request**

```json
{
  "$id":"preview_scene.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "scenePath":{"type":"string","description":"Optional. If omitted, use current start scene"}
  }
}
```

**Response**

```json
{
  "$id":"preview_scene.response",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "url":{"type":"string","pattern":"^https?://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?(/.*)?$"},
    "logs":{"type":"array","items":{"type":"string"}},
    "firstErrorLine":{"type":"integer","minimum":1}
  },
  "required":["url"]
}
```

**可能错误**：`E_PREVIEW_FAIL`, `E_TIMEOUT`, `E_POLICY_VIOLATION`

---

### 2.4 `list_snapshots`

**用途**：列出快照（按时间降序），支持过滤和限制数量

**Request**

```json
{
  "$id": "list_snapshots.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "limit": {
      "type": "number",
      "description": "最大返回数量（默认 50，最大 1000）。负数/NaN 会被规范化为 50",
      "default": 50,
      "minimum": 0,
      "maximum": 1000
    },
    "path": {
      "type": "string",
      "description": "按路径过滤（POSIX 格式前缀匹配，如 'game/scene'）"
    }
  }
}
```

**Response**

```json
{
  "$id": "list_snapshots.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "snapshots": {
      "type": "array",
      "description": "快照元数据数组（按时间降序，timestamp 相同时按 id 降序）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "description": "快照 ID（格式：snap_YYYYMMDDThhmmss_<8hex>）",
            "pattern": "^snap_\\d{8}T\\d{6}_[0-9a-f]{8}$"
          },
          "path": {
            "type": "string",
            "description": "文件路径（POSIX 格式，相对于项目根）"
          },
          "timestamp": {
            "type": "number",
            "description": "创建时间戳（毫秒）"
          },
          "contentHash": {
            "type": "string",
            "description": "内容 SHA-256 哈希（前 8 位）",
            "pattern": "^[0-9a-f]{8}$"
          },
          "idempotencyKey": {
            "type": "string",
            "description": "幂等性键（可选）"
          }
        },
        "required": ["id", "path", "timestamp", "contentHash"]
      }
    }
  },
  "required": ["snapshots"]
}
```

**语义与约束**

* **排序**：按 `timestamp` 降序（最新的在前），timestamp 相同时按 `id` 降序（稳定性）
* **过滤**：`path` 参数使用 POSIX 格式前缀匹配（`startsWith`），大小写敏感
* **限制**：`limit` 在过滤后应用，负数/NaN 会被规范化为默认值 50
* **健壮性**：跳过损坏的 `.meta.json` 文件和缺少对应 `.txt` 文件的快照
* **空结果**：目录不存在或无快照时返回空数组 `{ snapshots: [] }`

**可能错误**：`E_BAD_ARGS`（参数类型错误）、`E_INTERNAL`（IO 失败）

---

### 2.5 `restore_snapshot`

**用途**：恢复快照内容（用于预览 Diff 或实际恢复）

**Request**

```json
{
  "$id": "restore_snapshot.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "snapshotId": {
      "type": "string",
      "description": "快照 ID（格式：snap_YYYYMMDDThhmmss_<8hex>）",
      "pattern": "^snap_\\d{8}T\\d{6}_[0-9a-f]{8}$"
    }
  },
  "required": ["snapshotId"]
}
```

**Response**

```json
{
  "$id": "restore_snapshot.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "path": {
      "type": "string",
      "description": "文件路径（POSIX 格式，相对于项目根）"
    },
    "content": {
      "type": "string",
      "description": "文件内容（UTF-8 编码）"
    }
  },
  "required": ["path", "content"]
}
```

**语义与约束**

* **格式验证**：`snapshotId` 必须匹配格式 `snap_YYYYMMDDThhmmss_<8hex>`
* **文件完整性**：同时检查 `.txt` 和 `.meta.json` 文件是否存在
* **恢复流程**：通常先调用 `write_to_file` 的 `dryRun: true` 预览 Diff，用户确认后再 `dryRun: false` 应用

**可能错误**

* `E_BAD_ARGS`：snapshotId 为空、类型错误或格式不匹配
* `E_NOT_FOUND`：快照不存在（文件已被清理或从未存在）
* `E_PARSE_FAIL`：快照元数据损坏（JSON 解析失败）
* `E_INTERNAL`：IO 失败

**示例工作流**

```javascript
// 1. 列出快照
const { snapshots } = await listSnapshots({ path: 'game/scene', limit: 10 });

// 2. 恢复快照内容
const { path, content } = await restoreSnapshot({ snapshotId: snapshots[0].id });

// 3. 预览 Diff
const dryRunResult = await writeToFile({ path, content, dryRun: true });
// UI 显示 dryRunResult.diff

// 4. 用户确认后应用
const applyResult = await writeToFile({ path, content, dryRun: false });
// 返回新的 snapshotId
```

---

### 2.6 `get_runtime_info`

**用途**：获取当前 MCP 服务器的运行时环境信息和策略配置

**Request**

```json
{
  "$id": "get_runtime_info.request",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {}
}
```

**Response**

```json
{
  "$id": "get_runtime_info.response",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "projectRoot": { "type": "string", "description": "项目根目录绝对路径" },
    "snapshotRetention": { "type": "integer", "minimum": 0, "description": "快照保留数量" },
    "sandbox": {
      "type": "object",
      "properties": {
        "forbiddenDirs": { "type": "array", "items": { "type": "string" } },
        "maxReadBytes": { "type": "integer", "minimum": 1 },
        "textEncoding": { "type": "string", "enum": ["utf-8", "utf-16", "ascii"] }
      },
      "required": ["forbiddenDirs", "maxReadBytes", "textEncoding"]
    },
    "execution": {
      "type": "object",
      "description": "仅在启用时存在",
      "properties": {
        "enabled": { "type": "boolean", "const": true },
        "allowedCommands": { "type": "array", "items": { "type": "string" } },
        "timeoutMs": { "type": "integer", "minimum": 1 },
        "workingDir": { "type": "string" }
      },
      "required": ["enabled", "allowedCommands", "timeoutMs"]
    },
    "browser": {
      "type": "object",
      "description": "仅在启用时存在",
      "properties": {
        "enabled": { "type": "boolean", "const": true },
        "allowedHosts": { "type": "array", "items": { "type": "string" } },
        "timeoutMs": { "type": "integer", "minimum": 1 },
        "screenshotDir": { "type": "string" }
      },
      "required": ["enabled", "allowedHosts", "timeoutMs"]
    },
    "tools": { "type": "array", "items": { "type": "string" }, "description": "当前注册的工具名称列表" },
    "server": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" }
      },
      "required": ["name", "version"]
    }
  },
  "required": ["projectRoot", "snapshotRetention", "sandbox", "tools", "server"]
}
```

**语义约束**

1. **敏感字段剔除**：不返回 `redactEnv`、密钥等敏感配置
2. **条件字段**：`execution` 和 `browser` 仅在 `enabled: true` 时存在
3. **工具列表**：`tools` 数组包含所有当前注册的 MCP 工具名称
4. **版本格式**：`server.version` 遵循 semver 格式（如 `0.1.0`）

**示例返回**

```json
{
  "projectRoot": "/Users/user/projects/my-webgal-game",
  "snapshotRetention": 20,
  "sandbox": {
    "forbiddenDirs": ["node_modules", ".git"],
    "maxReadBytes": 5242880,
    "textEncoding": "utf-8"
  },
  "execution": {
    "enabled": true,
    "allowedCommands": ["yarn", "npm", "git"],
    "timeoutMs": 30000,
    "workingDir": "/Users/user/projects/my-webgal-game"
  },
  "browser": {
    "enabled": true,
    "allowedHosts": ["localhost", "127.0.0.1"],
    "timeoutMs": 15000,
    "screenshotDir": ".webgal_agent/screenshots"
  },
  "tools": [
    "list_files", "read_file", "write_to_file", "replace_in_file", "search_files",
    "validate_script", "list_project_resources", "preview_scene",
    "execute_command", "browser_action",
    "list_snapshots", "restore_snapshot", "get_runtime_info"
  ],
  "server": {
    "name": "webgal-agent",
    "version": "0.1.0"
  }
}
```

**可能错误**：无（只读操作，不应失败）

**用途场景**

- 前端 UI 展示当前运行环境和策略配置
- 调试时确认工具可用性和限制
- 生成策略配置建议（如调整 retention、maxReadBytes）

---

### 2.7 `generate_character_profile`（可选）

**用途**：按项目约定写入角色定义

**Request**

```json
{
  "$id":"generate_character_profile.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "name":{"type":"string","minLength":1},
    "imageFile":{"type":"string","minLength":1},
    "defaultExpression":{"type":"string"}
  },
  "required":["name","imageFile"]
}
```

**Response**

```json
{
  "$id":"generate_character_profile.response",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{"success":{"type":"boolean"}},
  "required":["success"]
}
```

**可能错误**：`E_DENY_PATH`, `E_CONFLICT`, `E_NOT_FOUND`（资源文件不存在）

---

## 3. 交互与完成信号

### 3.1 `ask_followup_question`

```json
{
  "$id":"ask_followup_question.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{"question":{"type":"string","minLength":1}},
  "required":["question"]
}
```

**Response**

```json
{ "ack": true }
```

### 3.2 `attempt_completion`

```json
{
  "$id":"attempt_completion.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{"result":{"type":"string","minLength":1}},
  "required":["result"]
}
```

**Response**

```json
{ "ack": true }
```

---

## 4. 命令与浏览器（仅开发者模式）

### 4.1 `execute_command`

**用途**：执行白名单脚本（来自目标项目 `package.json`）

**Request**

```json
{
  "$id":"execute_command.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "scriptName":{"type":"string","enum":["dev","build","lint"]},
    "args":{"type":"array","items":{"type":"string"}}
  },
  "required":["scriptName"]
}
```

**Response**

```json
{
  "$id":"execute_command.response",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "ok":{"type":"boolean"},
    "logs":{"type":"array","items":{"type":"string"}}
  },
  "required":["ok"]
}
```

**可能错误**：`E_POLICY_VIOLATION`, `E_TIMEOUT`, `E_INTERNAL`

---

### 4.2 `browser_action`（如启用）

**说明**：仅允许 `localhost/127.0.0.1` 目标；常用动作：`open`,`click`,`screenshot`

**Request**

```json
{
  "$id":"browser_action.request",
  "$schema":"https://json-schema.org/draft/2020-12/schema",
  "type":"object","additionalProperties": false,
  "properties":{
    "action":{"type":"string","enum":["open","click","screenshot"]},
    "url":{"type":"string","description":"Needed for action=open","pattern":"^https?://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?(/.*)?$"},
    "selector":{"type":"string","description":"Needed for action=click"},
    "path":{"type":"string","description":"Needed for action=screenshot"}
  },
  "allOf":[
    { "if": { "properties": { "action": { "const":"open" } } }, "then": { "required":["action","url"] } },
    { "if": { "properties": { "action": { "const":"click"} } }, "then": { "required":["action","selector"] } },
    { "if": { "properties": { "action": { "const":"screenshot"} } }, "then": { "required":["action","path"] } }
  ],
  "required":["action"]
}
```

**Response**

```json
{ "ok": true }
```

**可能错误**：`E_POLICY_VIOLATION`, `E_PREVIEW_FAIL`, `E_TIMEOUT`

---

## 5. 示例：端到端最小链路

### 5.1 生成场景（dry-run → 写入）

1. **生成内容后**调用：

```json
POST write_to_file
{"path":"game/scene/beach_date.txt","content":"changeBg: beach.jpg -next;\n雪乃: 海风真舒服呢;\n…","dryRun":true}
```

返回：

```json
{"applied":false,"diff":{"type":"line","hunks":[...]}}
```

2. 用户在 UI 确认 Diff → 真写入：

```json
{"path":"game/scene/beach_date.txt","content":"…","dryRun":false,"idempotencyKey":"0f4e…"}
→ {"applied":true,"snapshotId":"snap_20251101T101544_6ac29e1b","bytesWritten":845}
```

3. 校验与预览：

```json
POST validate_script {"path":"game/scene/beach_date.txt"}
→ {"valid":true,"diagnostics":[]}

POST preview_scene {"scenePath":"game/scene/beach_date.txt"}
→ {"url":"http://localhost:3001/preview#scene=beach_date"}
```

---

## 6. 策略（Policies）与模式（Modes）

**本地策略文件**（或 UI 配置）：

```json
{
  "contractVersion": "1.0.0",
  "mode": "cline",
  "policies": {
    "sandboxRoot": "${projectRoot}",
    "forbiddenDirs": [".git","node_modules",".env"],
    "writeRequiresDiff": true,
    "maxAutoFix": 1,
    "batchMaxLines": 2000,
    "allowedCommands": ["dev","build","lint"],
    "browserAllowedHosts": ["localhost","127.0.0.1"]
  }
}
```

---

## 7. 兼容性与扩展

* **Schema 扩展**：新增字段一律 **可选**；破坏性变更需提升 `contractVersion` 次版本并保留兼容期。
* **MCP 扩展**：`validate_script`/`list_project_resources`/`preview_scene` 都可通过 MCP Server 提供；调用面保持一致。
* **国际化**：`diagnostics.message` 默认中文，可通过环境变量切换 `ZH | EN`。
* **二进制资源**：工具层只做存在性检查；不承担解码/重采样。

---

## 8. 测试向量（建议最小集）

* `validate_script`：

  * 缺分号 → `kind=syntax`
  * 未知指令 → `kind=syntax`
  * 资源不存在 → `kind=resource`（提示相近文件名）
* `write_to_file`：

  * `dryRun=true` 返回 `diff`
  * `dryRun=false` 返回 `snapshotId`
  * 并发修改 → `E_CONFLICT`
* `preview_scene`：

  * Terre 未启动 → `E_PREVIEW_FAIL`
  * 非本地 URL → `E_POLICY_VIOLATION`

---

## 9. 安全与隐私

* **本地优先**：不上传本地文件，不扫描项目根之外内容。
* **BYOK**：API Key 仅存**本地**（Local/Session），支持一键清除。
* **日志**：默认本地可见；不外发。

---

## 10. 变更日志（片段）

* `1.0.0`：首版，覆盖 13 个工具；统一错误模型；Diff/快照/幂等；本地域/命令白名单。

