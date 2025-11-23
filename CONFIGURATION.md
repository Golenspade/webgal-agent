# WebGAL Agent 模型配置说明

## 概述

WebGAL Agent 现在支持通过多种方式配置 LLM 模型参数，包括 Anthropic、OpenAI、Qwen（阿里云）和 DeepSeek。

## 支持的提供商

| 提供商 | 说明 | 是否需要 baseURL |
|--------|------|-----------------|
| `anthropic` | Anthropic Claude 系列 | 否（默认） |
| `openai` | OpenAI GPT 系列 | 否（默认） |
| `qwen` | 阿里云通义千问 | **是** |
| `deepseek` | DeepSeek 模型 | 否 |

## 配置方式

### 方式 1：CLI 参数（最常用）

```bash
# Anthropic Claude (默认端点)
webgal-agent-mcpserver --project . \
  --model-provider anthropic \
  --model-name claude-3-5-sonnet-20241022 \
  --model-temperature 0.4 \
  --model-max-tokens 4000

# OpenAI GPT-4o (默认端点)
webgal-agent-mcpserver --project . \
  --model-provider openai \
  --model-name gpt-4o

# OpenRouter (访问多个提供商)
webgal-agent-mcpserver --project . \
  --model-provider openai \
  --model-name openai/gpt-4o \
  --model-base-url https://openrouter.ai/api/v1

# 阿里云 Qwen
webgal-agent-mcpserver --project . \
  --model-provider qwen \
  --model-name qwen-max \
  --model-base-url https://dashscope.aliyuncs.com/api/v1

# DeepSeek
webgal-agent-mcpserver --project . \
  --model-provider deepseek \
  --model-name deepseek-chat
```

**CLI 参数说明：**
- `--model-provider`: 提供商名称 (`anthropic`, `openai`, `qwen`, `deepseek`)
- `--model-name`: 模型名称（格式取决于提供商）
- `--model-temperature`: Temperature (0-2, 默认: 0.4)
- `--model-max-tokens`: 最大输出 token 数 (默认: 4000)
- `--model-base-url`: 自定义 API 端点（用于 OpenRouter 或自定义部署）

### 方式 2：policies.json 配置文件

编辑 `configs/policies.json`：

```json
{
  "models": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.4,
    "maxTokens": 4000,
    "baseURL": null
  }
}
```

### 方式 3：前端界面（观测）

前端界面目前支持**查看**运行时配置，但不支持修改模型参数。模型配置需要在启动时通过 CLI 或 policies.json 指定。

## 模型名称格式

### Anthropic
- `claude-3-5-sonnet-20241022`
- `claude-3-opus-20240229`
- `claude-3-haiku-20240307`

### OpenAI
- `gpt-4o`
- `gpt-4-turbo-preview`
- `gpt-3.5-turbo`

### OpenRouter（统一访问多提供商）
格式：`提供商/模型名`
- `openai/gpt-4o`
- `anthropic/claude-3-5-sonnet`
- `google/gemini-pro`
- `meta-llama/llama-3-70b`

### 阿里云 Qwen
- `qwen-max` (旗舰版)
- `qwen-plus` (Plus版)
- `qwen-turbo` (Turbo版)
- `qwen-math-32b` (数学专用)
- `qwen-code-32b` (代码专用)

### DeepSeek
- `deepseek-chat` (DeepSeek-V2.5)
- `deepseek-coder` (代码专用)
- `deepseek-reasoner` (推理模型)

## 实际使用示例

### 场景 1：使用 OpenRouter 节约成本

OpenRouter 允许你访问多个模型，并自动选择最便宜的提供商：

```bash
webgal-agent-mcpserver --project . \
  --model-provider openai \
  --model-name anthropic/claude-3-5-sonnet \
  --model-base-url https://openrouter.ai/api/v1 \
  --enable-exec
```

### 场景 2：使用阿里云 Qwen（国内访问）

```bash
export DASHSCOPE_API_KEY="sk-your-qwen-key"

webgal-agent-mcpserver --project . \
  --model-provider qwen \
  --model-name qwen-max \
  --model-base-url https://dashscope.aliyuncs.com/api/v1 \
  --enable-exec
```

### 场景 3：使用 DeepSeek

```bash
export DEEPSEEK_API_KEY="sk-your-deepseek-key"

webgal-agent-mcpserver --project . \
  --model-provider deepseek \
  --model-name deepseek-chat \
  --enable-exec
```

## 优先级

配置优先级（从高到低）：

1. CLI 参数 (`--model-provider`, `--model-name` 等)
2. policies.json (`configs/policies.json`)
3. 代码默认值 (provider: anthropic, model: claude-3-5-sonnet-20241022)

## 接口定义

### LLMConfig 接口（packages/agent-core/src/providers/llm.ts）

```typescript
export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'qwen' | 'deepseek';
  apiKey: string;
  model?: string;
  temperature?: number;  // 0-2, 默认: 0.4
  maxTokens?: number;    // 默认: 4000
  baseURL?: string;      // 用于自定义端点
}
```

### PolicyFile 接口（packages/mcp-webgal/src/config.ts）

```typescript
export interface PolicyFile {
  // ... 其他配置 ...
  models?: {
    provider?: 'anthropic' | 'openai' | 'qwen' | 'deepseek';
    model?: string;
    temperature?: number;
    maxTokens?: number;
    baseURL?: string;
  };
}
```

## 注意事项

1. **API Key 安全性**：API Key 应该通过环境变量或安全的方式传递，不要在命令行中暴露
2. **网络访问**：Qwen 和 DeepSeek 需要国内/国际网络访问权限
3. **费用**：不同模型的定价不同，请注意监控使用情况
4. **Rate Limit**：OpenRouter 等代理服务可以帮助管理 rate limit

## 前端集成（未来）

计划在未来版本中，前端界面将支持：
- [ ] 模型提供商选择下拉菜单
- [ ] 模型名称输入/选择
- [ ] API Key 配置界面
- [ ] Temperature 和 maxTokens 滑块/输入框
- [ ] Base URL 配置（用于自定义部署）

目前，前端界面可以**查看**当前的模型配置（通过 RuntimeInfo 组件），但修改需要通过重新启动 MCP 服务器来生效。
