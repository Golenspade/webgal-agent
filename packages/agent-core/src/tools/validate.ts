/**
 * WebGAL 脚本校验工具
 * 严格按照 CONTRACTS.md 2.2 validate_script 规范
 */

import * as fs from 'node:fs/promises';
import { FsSandbox, ErrorCode } from '@webgal-agent/tool-bridge';
import type {
  ValidateScriptRequest,
  ValidateScriptResponse,
  Diagnostic,
} from '../types/index.js';

/**
 * WebGAL 常用指令白名单（基于 PROMPTS.md）
 * 已去重并按类别组织
 */
const WEBGAL_COMMANDS = new Set([
  // 对话与文本
  'intro',
  'say',

  // 背景与立绘
  'changeBg',
  'changeFigure',
  'miniAvatar',

  // 音频
  'bgm',
  'playEffect',
  'playVocal',

  // 场景与分支
  'changeScene',
  'callScene',
  'choose',
  'label',
  'jumpLabel',

  // 变量与条件
  'setVar',
  'setTextbox',

  // 特效与动画
  'pixiInit',
  'pixiPerform',
  'setAnimation',
  'setFilter',
  'setTransform',

  // 视频与模式
  'video',
  'filmMode',

  // 其他
  'comment',
  'end',
  'getUserInput',
  'setComplexAnimation',
  'unlockCg',
  'unlockBgm',
]);

/**
 * 脚本校验器类
 */
export class ScriptValidator {
  private sandbox: FsSandbox;
  private projectRoot: string;

  constructor(sandbox: FsSandbox, projectRoot: string) {
    this.sandbox = sandbox;
    this.projectRoot = projectRoot;
  }

  /**
   * 校验脚本
   */
  async validate(request: ValidateScriptRequest): Promise<ValidateScriptResponse> {
    let content: string;

    // 获取内容
    if (request.content) {
      content = request.content;
    } else if (request.path) {
      const absolutePath = this.sandbox.validatePath(request.path);
      try {
        content = await fs.readFile(absolutePath, 'utf-8');
      } catch (err) {
        throw {
          error: {
            code: ErrorCode.E_NOT_FOUND,
            message: `Script file not found: ${request.path}`,
            details: { path: request.path },
            recoverable: true,
          },
        };
      }
    } else {
      throw {
        error: {
          code: ErrorCode.E_BAD_ARGS,
          message: 'Either path or content must be provided',
          recoverable: true,
        },
      };
    }

    const diagnostics: Diagnostic[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNumber = i + 1;

      // 跳过空行和纯注释行
      if (!line || line.startsWith(';')) {
        continue;
      }

      // 检查分号结尾
      if (!line.endsWith(';')) {
        diagnostics.push({
          line: lineNumber,
          kind: 'syntax',
          message: '语句必须以分号结尾',
          fixHint: `在行尾添加分号: ${line};`,
        });
      }

      // 提取指令部分（冒号前或整行）
      const colonIndex = line.indexOf(':');

      if (colonIndex > 0) {
        const beforeColon = line.substring(0, colonIndex).trim();
        // 可能是 "角色:台词" 或 "指令:参数"
        // 检查是否看起来像指令（驼峰命名）
        const looksLikeCommand = /^[a-z][a-zA-Z0-9_]*$/.test(beforeColon);

        if (looksLikeCommand) {
          // 看起来像指令，检查是否在白名单中
          if (!WEBGAL_COMMANDS.has(beforeColon)) {
            diagnostics.push({
              line: lineNumber,
              kind: 'syntax',
              message: `未知指令: ${beforeColon}`,
              fixHint: '检查指令拼写或参考 WebGAL 文档',
            });
          }
        }
        // 否则认为是角色名，不报错
      } else {
        // 没有冒号，可能是纯指令
        const firstWord = line.split(/[\s;]/)[0];
        if (firstWord && !WEBGAL_COMMANDS.has(firstWord)) {
          const looksLikeCommand = /^[a-z][a-zA-Z0-9_]*$/.test(firstWord);
          if (looksLikeCommand) {
            diagnostics.push({
              line: lineNumber,
              kind: 'syntax',
              message: `未知指令: ${firstWord}`,
              fixHint: '检查指令拼写或参考 WebGAL 文档',
            });
          }
        }
      }

      // 检查资源引用（简单版本）
      await this.checkResourceReferences(line, lineNumber, diagnostics);
    }

    return {
      valid: diagnostics.length === 0,
      diagnostics,
    };
  }

  /**
   * 检查资源引用
   */
  private async checkResourceReferences(
    line: string,
    lineNumber: number,
    diagnostics: Diagnostic[]
  ): Promise<void> {
    // 检查背景
    if (line.includes('changeBg:')) {
      const match = line.match(/changeBg:\s*([^\s;-]+)/);
      if (match && match[1] !== 'none') {
        const bgFile = match[1];
        const exists = await this.checkFileExists('game/background', bgFile);
        if (!exists) {
          diagnostics.push({
            line: lineNumber,
            kind: 'resource',
            message: `背景文件不存在: ${bgFile}`,
            fixHint: '检查 game/background 目录中的文件名',
          });
        }
      }
    }

    // 检查立绘
    if (line.includes('changeFigure:')) {
      const match = line.match(/changeFigure:\s*([^\s;-]+)/);
      if (match && match[1] !== 'none') {
        const figFile = match[1];
        const exists = await this.checkFileExists('game/figure', figFile);
        if (!exists) {
          diagnostics.push({
            line: lineNumber,
            kind: 'resource',
            message: `立绘文件不存在: ${figFile}`,
            fixHint: '检查 game/figure 目录中的文件名',
          });
        }
      }
    }

    // 检查 BGM
    if (line.includes('bgm:')) {
      const match = line.match(/bgm:\s*([^\s;-]+)/);
      if (match && match[1] !== 'none') {
        const bgmFile = match[1];
        const exists = await this.checkFileExists('game/bgm', bgmFile);
        if (!exists) {
          diagnostics.push({
            line: lineNumber,
            kind: 'resource',
            message: `BGM 文件不存在: ${bgmFile}`,
            fixHint: '检查 game/bgm 目录中的文件名',
          });
        }
      }
    }

    // 检查语音
    if (line.includes('playVocal:')) {
      const match = line.match(/playVocal:\s*([^\s;-]+)/);
      if (match && match[1] !== 'none') {
        const vocalFile = match[1];
        const exists = await this.checkFileExists('game/vocal', vocalFile);
        if (!exists) {
          diagnostics.push({
            line: lineNumber,
            kind: 'resource',
            message: `语音文件不存在: ${vocalFile}`,
            fixHint: '检查 game/vocal 目录中的文件名',
          });
        }
      }
    }

    // 检查场景跳转
    if (line.includes('changeScene:') || line.includes('callScene:')) {
      const match = line.match(/(?:changeScene|callScene):\s*([^\s;-]+)/);
      if (match) {
        const sceneFile = match[1];
        const exists = await this.checkFileExists('game/scene', sceneFile);
        if (!exists) {
          diagnostics.push({
            line: lineNumber,
            kind: 'resource',
            message: `场景文件不存在: ${sceneFile}`,
            fixHint: '检查 game/scene 目录中的文件名',
          });
        }
      }
    }
  }

  /**
   * 检查文件是否存在
   */
  private async checkFileExists(dir: string, filename: string): Promise<boolean> {
    try {
      const filePath = `${dir}/${filename}`;
      const absolutePath = this.sandbox.validatePath(filePath);
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}

