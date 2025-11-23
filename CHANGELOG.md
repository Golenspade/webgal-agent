# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Orchestrator Core Implementation** (`packages/agent-core/src/orchestrator/machine.ts`)
  - Implemented complete Plan→Act cycle state machine
  - Added state management: idle → planning → awaiting_plan_confirmation → generating → validating → previewing → awaiting_write_confirmation → writing → done/error
  - Added scene generation with automatic validation and fix attempts
  - Added preview functionality for first scene
  - Added write confirmation with dry-run capability
  - Implemented runtime info tracking and state reset

- **Prompt Builder** (`packages/agent-core/src/prompt/builder.ts`)
  - Built WebGAL-specific LLM prompt templates
  - Added system prompt with resource awareness
  - Added plan generation prompt for scene planning
  - Added script generation prompt for WebGAL syntax
  - Added fix prompt for automatic error correction
  - Added resource analysis prompt for project scanning

- **LLM Provider** (`packages/agent-core/src/providers/llm.ts`)
  - Implemented multi-provider LLM support (Anthropic, OpenAI, Qwen, DeepSeek)
  - Added BYOK (Bring Your Own Key) mode
  - Implemented token usage tracking
  - Added support for custom endpoints (e.g., OpenRouter)
  - Added error handling and response validation

- **CLI Tool** (`packages/agent-core/src/cli.ts`) - NEW FILE
  - Implemented command-line interface for testing Orchestrator
  - Added interactive mode with user confirmations
  - Added scene preview URL display
  - Implemented write confirmation prompts
  - Added support for different LLM providers

- **Dependencies**
  - Added `@anthropic-ai/sdk ^0.30.0` for Anthropic Claude API
  - Added `openai ^4.0.0` for OpenAI compatible APIs
  - Added `typescript ^5.0.0` as dev dependency

### Changed

- **package.json** (`packages/agent-core/package.json`)
  - Added CLI scripts: `cli` and `cli:help`
  - Updated dependencies to include LLM SDKs

### Fixed

- **Type Safety**
  - Added null checks for `currentPlan` in Orchestrator
  - Added optional chaining for safe property access
  - Fixed ExecutionConfig and BrowserConfig missing required properties
  - Added path module import for cross-platform compatibility

## [Previous Versions]

*Initial project structure and placeholder implementations*
