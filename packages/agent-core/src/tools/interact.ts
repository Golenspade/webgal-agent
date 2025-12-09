/**
 * 交互工具 - 人在回路
 * 严格按照 CONTRACTS.md 3.x 规范
 */

import type {
  AskFollowupQuestionRequest,
  AskFollowupQuestionResponse,
  AttemptCompletionRequest,
  AttemptCompletionResponse,
} from '../types/index.js'

/**
 * 交互工具类
 */
export class InteractionTools {
  /**
   * 3.1 ask_followup_question - 追问用户
   */
  async askFollowupQuestion(
    request: AskFollowupQuestionRequest,
  ): Promise<AskFollowupQuestionResponse> {
    // 这是一个占位实现
    // 实际使用时，应该通过 UI 层与用户交互
    console.log('[ASK] ', request.question)

    return {
      ack: true,
    }
  }

  /**
   * 3.2 attempt_completion - 呈现完成结果
   */
  async attemptCompletion(request: AttemptCompletionRequest): Promise<AttemptCompletionResponse> {
    // 这是一个占位实现
    // 实际使用时，应该通过 UI 层展示结果
    console.log('[COMPLETE] ', request.result)

    return {
      ack: true,
    }
  }
}
