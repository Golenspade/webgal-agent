#!/usr/bin/env node

/**
 * WebGAL Agent CLI - 命令行测试工具
 * 用于测试Orchestrator的Plan→Act循环
 */

import * as path from 'path'
import { Orchestrator } from './orchestrator/machine.js'
import { WebGALAgentTools } from './tools/index.js'

interface CLIArgs {
  project: string
  apiKey: string
  provider: 'anthropic' | 'openai' | 'qwen' | 'deepseek'
  model?: string
  request?: string
  interactive?: boolean
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2)
  const result: Partial<CLIArgs> = {
    provider: 'anthropic',
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--project':
      case '-p':
        result.project = args[++i]
        break
      case '--api-key':
      case '-k':
        result.apiKey = args[++i]
        break
      case '--provider':
        result.provider = args[++i] as CLIArgs['provider']
        break
      case '--model':
        result.model = args[++i]
        break
      case '--request':
      case '-r':
        result.request = args[++i]
        break
      case '--interactive':
      case '-i':
        result.interactive = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  if (!result.project) {
    throw new Error('Missing required parameter: --project')
  }

  if (!result.apiKey) {
    // 尝试从环境变量读取
    result.apiKey =
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.LLM_API_KEY
    if (!result.apiKey) {
      throw new Error('Missing API key. Provide --api-key or set LLM_API_KEY environment variable')
    }
  }

  return result as CLIArgs
}

function printHelp() {
  console.log(`
WebGAL Agent CLI - WebGAL AI助手命令行工具

用法:
  webgal-agent --project <path> --api-key <key> [选项]

必填参数:
  --project, -p <path>      WebGAL项目根目录
  --api-key, -k <key>       LLM API密钥（或设置 LLM_API_KEY 环境变量）

可选参数:
  --provider <anthropic|openai|qwen|deepseek>
                            LLM提供商 (默认: anthropic)
  --model <model>           指定模型 (默认: claude-3-5-sonnet-20241022)
  --request, -r <text>      直接指定请求（非交互模式）
  --interactive, -i         交互模式（逐步确认）
  --help, -h                显示帮助

环境变量:
  ANTHROPIC_API_KEY         Claude API密钥
  OPENAI_API_KEY            OpenAI API密钥
  LLM_API_KEY               通用LLM API密钥

示例:
  # 交互模式
  webgal-agent --project ./my-game --api-key sk-ant-xxx -i

  # 直接执行请求
  webgal-agent --project ./my-game --api-key sk-ant-xxx \
    --request "创建一个海滩约会场景，包含两个分支"

  # 使用OpenAI
  webgal-agent --project ./my-game --api-key sk-xxx \
    --provider openai --model gpt-4-turbo-preview
`)
}

async function interactiveMode(args: CLIArgs) {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve))

  try {
    console.log('\n=== WebGAL Agent 交互模式 ===\n')

    // 1. 获取用户请求
    const userRequest = args.request || (await question('请输入你的创作需求: '))
    console.log('\n请求已接收，正在生成计划...\n')

    // 2. 初始化工具
    const tools = new WebGALAgentTools({
      projectRoot: args.project,
      sandbox: {
        projectRoot: args.project,
        forbiddenDirs: ['.git', 'node_modules', '.env', '.webgal_agent'],
        maxReadBytes: 1048576,
        textEncoding: 'utf-8',
      },
      execution: {
        enabled: false,
        allowedCommands: [],
        timeoutMs: 60000,
        workingDir: args.project,
        redactEnv: ['API_KEY', 'SECRET', 'TOKEN'],
      },
      browser: {
        enabled: false,
        allowedHosts: [],
        screenshotDir: path.join(args.project, '.webgal_agent/screenshots'),
        timeoutMs: 30000,
      },
      snapshotRetention: 20,
    })

    // 3. 初始化Orchestrator
    const orchestrator = new Orchestrator({
      llmConfig: {
        provider: args.provider,
        apiKey: args.apiKey,
        model: args.model,
      },
      projectRoot: args.project,
      tools,
    })

    // 4. 定义回调
    const callbacks = {
      onPlanGenerated: (plan: any) => {
        console.log('\n📋 生成的场景计划:')
        console.log(`共 ${plan.totalScenes} 个场景`)
        plan.scenes.forEach((scene: any, idx: number) => {
          console.log(`\n${idx + 1}. ${scene.file}`)
          console.log(`   背景: ${scene.background}`)
          console.log(`   角色: ${scene.characters.join(', ')}`)
          console.log(`   概述: ${scene.summary}`)
          if (scene.resourcesNeeded?.length > 0) {
            console.log(`   所需资源: ${scene.resourcesNeeded.join(', ')}`)
          }
        })
        if (plan.missingResources?.length > 0) {
          console.log(`\n⚠️  缺失资源: ${plan.missingResources.join(', ')}`)
        }
      },

      onPlanConfirmation: async () => {
        if (!args.interactive) return true
        const answer = await question('\n是否确认执行此计划? (y/n): ')
        return answer.toLowerCase() === 'y'
      },

      onSceneGenerated: (file: string, content: string) => {
        console.log(`\n✍️  已生成: ${file}`)
        console.log('--- 脚本内容 ---')
        console.log(content)
        console.log('----------------')
      },

      onValidation: (valid: boolean, errors?: any[]) => {
        if (valid) {
          console.log('✅ 脚本校验通过')
        } else {
          console.log('❌ 脚本校验失败:')
          errors?.forEach((err) => console.log(`   - ${err.message}`))
        }
      },

      onPreview: (url: string) => {
        console.log(`\n🎮 预览URL: ${url}`)
        console.log('   请在浏览器中打开查看效果')
      },

      onWriteConfirmation: async (file: string, diff: any) => {
        if (!args.interactive) return true
        const answer = await question('\n是否确认写入文件? (y/n): ')
        return answer.toLowerCase() === 'y'
      },

      onComplete: (result: any) => {
        console.log('\n=== 任务完成 ===')
        if (result.success) {
          console.log(`✅ ${result.message}`)
        } else {
          console.log(`❌ ${result.message}`)
          if (result.error) {
            console.log(`错误: ${result.error.message || result.error}`)
          }
        }
      },
    }

    // 5. 执行Orchestrator
    const result = await orchestrator.run(userRequest, callbacks)

    rl.close()
    return result
  } catch (error) {
    console.error('\n❌ 执行失败:', error)
    rl.close()
    process.exit(1)
  }
}

async function main() {
  try {
    const args = parseArgs()

    console.log('\n🎮 WebGAL Agent CLI 启动')
    console.log(`项目: ${args.project}`)
    console.log(`LLM: ${args.provider}${args.model ? ` (${args.model})` : ''}`)

    // 执行交互模式
    const result = await interactiveMode(args)

    process.exit(result.success ? 0 : 1)
  } catch (error) {
    console.error('\n❌ 错误:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// 运行主函数
main().catch((error) => {
  console.error('未捕获的错误:', error)
  process.exit(1)
})
