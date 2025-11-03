/**
 * 类型定义 - 严格按照 CONTRACTS.md 的 JSON Schema
 */

import { ErrorCode } from '@webgal-agent/tool-bridge';

/**
 * 统一错误结构（CONTRACTS.md 0.2）
 */
export interface ToolError {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    hint?: string;
    recoverable?: boolean;
  };
}

// ============ 1. 基础文件 & 检索工具 ============

/**
 * 1.1 list_files
 */
export interface ListFilesRequest {
  path: string;
  globs?: string[];
  dirsOnly?: boolean;
}

export interface ListFilesResponse {
  entries: string[];
}

/**
 * 1.2 read_file
 */
export interface ReadFileRequest {
  path: string;
  maxBytes?: number;
}

export interface ReadFileResponse {
  path: string;
  content: string;
  encoding?: 'utf-8';
  bytes?: number;
}

/**
 * 1.3 write_to_file
 */
export interface WriteToFileRequest {
  path: string;
  content: string;
  mode?: 'overwrite' | 'append';
  dryRun: boolean;
  idempotencyKey?: string;
}

export interface DiffHunk {
  startOld: number;
  lenOld: number;
  startNew: number;
  lenNew: number;
  linesOld: string[];
  linesNew: string[];
}

export interface Diff {
  type: 'line';
  hunks: DiffHunk[];
}

export interface WriteToFileResponse {
  applied: boolean;
  diff?: Diff;
  snapshotId?: string;
  bytesWritten?: number;
}

/**
 * 1.4 replace_in_file
 */
export interface ReplaceInFileRequest {
  path: string;
  find: string;
  replace: string;
  flags?: string;
}

export interface ReplaceInFileResponse {
  count: number;
}

/**
 * 1.5 search_files
 */
export interface SearchFilesRequest {
  path: string;
  regex: string;
  filePattern?: string;
  maxMatches?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

export interface SearchFilesResponse {
  matches: SearchMatch[];
}

// ============ 2. WebGAL 专用工具 ============

/**
 * 2.1 list_project_resources
 */
export interface ListProjectResourcesResponse {
  backgrounds: string[];
  figures: string[];
  bgm: string[];
  vocals: string[];
  scenes: string[];
}

/**
 * 2.2 validate_script
 */
export interface ValidateScriptRequest {
  path?: string;
  content?: string;
}

export interface Diagnostic {
  line: number;
  kind: 'syntax' | 'resource' | 'style';
  message: string;
  fixHint?: string;
}

export interface ValidateScriptResponse {
  valid: boolean;
  diagnostics: Diagnostic[];
}

/**
 * 2.3 list_snapshots
 */
export interface ListSnapshotsRequest {
  limit?: number;
  path?: string;
}

export interface SnapshotMetadata {
  id: string;
  path: string;
  timestamp: number;
  contentHash: string;
  idempotencyKey?: string;
}

export interface ListSnapshotsResponse {
  snapshots: SnapshotMetadata[];
}

/**
 * 2.4 restore_snapshot
 */
export interface RestoreSnapshotRequest {
  snapshotId: string;
}

export interface RestoreSnapshotResponse {
  path: string;
  content: string;
}

/**
 * 2.5 preview_scene
 */
export interface PreviewSceneRequest {
  scenePath?: string;
}

export interface PreviewSceneResponse {
  url: string;
  logs?: string[];
  firstErrorLine?: number;
}

/**
 * 2.6 generate_character_profile
 */
export interface GenerateCharacterProfileRequest {
  name: string;
  imageFile: string;
  defaultExpression?: string;
}

export interface GenerateCharacterProfileResponse {
  success: boolean;
}

// ============ 3. 交互与完成信号 ============

/**
 * 3.1 ask_followup_question
 */
export interface AskFollowupQuestionRequest {
  question: string;
}

export interface AskFollowupQuestionResponse {
  ack: boolean;
}

/**
 * 3.2 attempt_completion
 */
export interface AttemptCompletionRequest {
  result: string;
}

export interface AttemptCompletionResponse {
  ack: boolean;
}

// ============ 4. 命令与浏览器 ============

/**
 * 4.1 execute_command
 */
export interface ExecuteCommandRequest {
  scriptName: 'dev' | 'build' | 'lint';
  args?: string[];
}

export interface ExecuteCommandResponse {
  ok: boolean;
  logs?: string[];
}

/**
 * 4.2 browser_action
 */
export interface BrowserActionRequest {
  action: 'open' | 'click' | 'screenshot';
  url?: string;
  selector?: string;
  path?: string;
}

export interface BrowserActionResponse {
  ok: boolean;
}

