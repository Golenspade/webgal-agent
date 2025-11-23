/**
 * Prompt Builder - 构建WebGAL专用的LLM提示词
 */

export interface PromptContext {
  projectRoot: string;
  resources?: {
    backgrounds: string[];
    figures: string[];
    bgm: string[];
    vocals: string[];
    scenes: string[];
  };
  currentScene?: string;
  goal?: string;
}

export class PromptBuilder {
  /**
   * 构建System Prompt
   */
  buildSystemPrompt(context: PromptContext): string {
    const resourceSection = context.resources
      ? `当前可用资源：
背景：${context.resources.backgrounds.join(', ')}
立绘：${context.resources.figures.join(', ')}
BGM：${context.resources.bgm.join(', ')}
语音：${context.resources.vocals.join(', ')}
场景：${context.resources.scenes.join(', ')}

重要：只能使用上述已有资源！如资源缺失，请明确指出缺失清单而不是编造。`
      : '';

    return `你是一名WebGAL剧本创作助手。你的任务是将用户需求转化为可运行的WebGAL脚本。

${resourceSection}

WebGAL语法规则（务必遵守）：
1. 每行必须以英文分号;结尾
2. 使用英文冒号:
3. 对话格式：角色:台词;
4. 切背景：changeBg:文件名; (需要立即生效请加 -next)
5. 播放BGM：bgm:文件名;
6. 分支：choose:选项1:场景1.txt|选项2:场景2.txt;
7. 跳转：jumpLabel:标签名; 和 label:标签名;
8. 条件：-when=(变量>1)
9. 变量赋值：setVar:变量名=值;

工作流程：
1. 先理解用户需求
2. 检查资源是否齐全
3. 生成WebGAL脚本
4. 确保语法正确，所有资源都存在
5. 如有缺失资源，明确列出清单

只输出WebGAL脚本，不要添加额外解释。`;
  }

  /**
   * 构建计划生成提示
   */
  buildPlanPrompt(userRequest: string, context: PromptContext): string {
    return `用户需求：${userRequest}

请分析需求并生成一个详细的场景计划。计划应包括：
1. 需要创建/修改哪些场景文件
2. 每个场景的主要内容（背景、角色、对话、分支）
3. 需要的资源清单
4. 场景之间的跳转关系

以JSON格式输出：
{
  "scenes": [
    {
      "file": "game/scene/xxx.txt",
      "background": "背景文件名",
      "characters": ["角色1", "角色2"],
      "summary": "场景概述",
      "resources_needed": ["bg1.jpg", "char1.png"]
    }
  ],
  "total_scenes": 数量,
  "missing_resources": ["缺失的资源"]
}`;
  }

  /**
   * 构建脚本生成提示
   */
  buildScriptPrompt(
    sceneInfo: {
      file: string;
      background: string;
      characters: string[];
      summary: string;
      previousContext?: string;
    },
    context: PromptContext
  ): string {
    const resourceCheck = context.resources
      ? `可用资源：\n背景：${context.resources.backgrounds.join(', ')}\n立绘：${context.resources.figures.join(', ')}`
      : '';

    return `生成WebGAL脚本：${sceneInfo.file}

场景要求：
- 背景：${sceneInfo.background}
- 角色：${sceneInfo.characters.join(', ')}
- 内容：${sceneInfo.summary}
- 上一场景上下文：${sceneInfo.previousContext || '无'}

${resourceCheck}

请生成完整的WebGAL脚本：
1. 以changeBg开头（如果需要）
2. 角色对话每句以分号结尾
3. 需要连续执行的地方添加 -next
4. 分支要确保收束
5. 只输出脚本内容，不要解释`;
  }

  /**
   * 构建修复提示
   */
  buildFixPrompt(
    content: string,
    diagnostics: Array<{
      line: number;
      kind: 'syntax' | 'resource' | 'style';
      message: string;
      fixHint?: string;
    }>
  ): string {
    const errors = diagnostics
      .map(d => `第${d.line}行: ${d.message}${d.fixHint ? ` (${d.fixHint})` : ''}`)
      .join('\n');

    return `修复以下WebGAL脚本的错误：

脚本内容：
${content}

错误列表：
${errors}

请输出修复后的完整脚本，确保：
1. 所有语法错误已修正
2. 资源引用正确
3. 每条语句以分号结尾
4. 只输出修复后的脚本，不要添加解释`;
  }

  /**
   * 构建资源分析提示
   */
  buildResourceAnalysisPrompt(): string {
    return `分析项目资源。请列出：
1. 所有背景图片（game/background/）
2. 所有立绘图片（game/figure/）
3. 所有BGM（game/bgm/）
4. 所有语音（game/vocal/）
5. 所有场景文件（game/scene/）

以JSON格式输出：
{
  "backgrounds": ["文件名1", "文件名2"],
  "figures": ["..."],
  "bgm": ["..."],
  "vocals": ["..."],
  "scenes": ["..."]
}`;
  }

  /**
   * 构建追问提示
   */
  buildFollowUpPrompt(question: string): string {
    return `用户需要澄清：${question}

请用中文友好地提问，帮助明确需求。`;
  }
}
