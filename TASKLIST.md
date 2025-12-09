# WebGAL Agent 基础设施对齐任务列表

> 创建时间: 2024-12-08
> 目标: 将 webgal_agent 基础设施与 WebGAL 官方对齐

---

## 📋 任务状态图例

- ⬜ 待开始
- 🟡 进行中
- ✅ 已完成
- ⏸️ 已挂起
- ❌ 已取消

---

## 优先级 1 - 必须

### 1.1 添加 `engines` 和 `packageManager` 字段
- **状态**: ✅ 已完成
- **文件**: `package.json`
- **内容**:
  - 添加 `"engines": { "node": ">=18" }`
  - 添加 `"packageManager": "yarn@1.22.22"`
- **参考**: WebGAL_Terre/package.json

### 1.2 配置 ESLint
- **状态**: ✅ 已完成
- **文件**: `.eslintrc.json` → `.eslintrc.js`
- **内容**:
  - ✅ 转换为 JS 格式 (与官方一致)
  - ✅ 添加 `@typescript-eslint/parser`
  - ✅ 添加 `@typescript-eslint/eslint-plugin`
  - ✅ 添加 `eslint-plugin-prettier`
  - ✅ 继承 `plugin:@typescript-eslint/recommended`
  - ✅ 继承 `plugin:prettier/recommended`
- **依赖**: 已添加到 devDependencies

### 1.3 完善 Prettier 配置
- **状态**: ✅ 已完成
- **文件**: `.prettierrc.json`
- **内容**: 与官方对齐 (singleQuote, trailingComma, endOfLine: lf)
- **添加**: tabWidth, useTabs, endOfLine

### 1.4 评估 GitHub Actions CI
- **状态**: ✅ 评估完成 (结论: 暂不需要)
- **文件**: `.github/workflows/ci.yml` (新建)
- **评估结论**:
  - ❌ 独立仓库已归档，不需要独立 CI
  - ⚠️ 项目现在作为 WebGAL_Terre 的子目录/符号链接存在
  - 💡 建议: 在 WebGAL_Terre fork 中添加 CI 时一并覆盖 webgal_agent
  - 🔮 未来: 如果需要，可以在 WebGAL_Terre/.github/workflows/ 中添加
- **暂不行动原因**:
  - webgal-agent 独立仓库已归档
  - 本地开发使用 `yarn lint` / `yarn test` 即可
  - 等 WebGAL_Terre fork 稳定后再考虑 CI

---

## 优先级 2 - 推荐

### 2.1 统一 TypeScript 版本
- **状态**: ✅ 已完成
- **目标版本**: ^5.8.3 (与 WebGAL 官方一致)
- **之前版本**: ^5.0.0 / ^5.3.0 (各包不一致)
- **已更新文件**:
  - ✅ `package.json` (根)
  - ✅ `packages/agent-core/package.json`
  - ✅ `packages/mcp-webgal/package.json`
  - ✅ `packages/tool-bridge/package.json`
  - ✅ `packages/testing/package.json`
- **TypeScript 5.8 新特性对 AI/开发的影响**:
  - 更快的程序加载和更新 (路径规范化优化，减少数组分配)
  - 更严格的 import assertions 检查 (`assert` → `with`)
  - 更好的 watch 模式可靠性 (减少需要重启 TSServer)
  - 编辑器集成改进 (对 Copilot/AI 辅助编码更友好)
  - 智能复用验证结果 (编辑大项目时更响应)

### 2.2 完善 scripts
- **状态**: ✅ 已完成
- **之前问题**: 多个 stub 脚本 (`echo build:stub`)
- **已实现**:
  - ✅ `build`: `yarn workspaces run build`
  - ✅ `lint`: `eslint 'packages/*/src/**/*.ts' --fix`
  - ✅ `lint:check`: 仅检查不修复
  - ✅ `test`: `yarn workspace @webgal-agent/agent-core test`
  - ✅ `clean`: `yarn workspaces run clean`
  - ✅ `format`: `prettier --write`
  - ✅ `format:check`: `prettier --check`

---

## 优先级 3 - 可选

### 3.1 移除/简化 Changesets
- **状态**: ⬜ 待开始
- **原因**: 如果不打算发布 npm 包，可以移除

### 3.2 清理占位目录
- **状态**: ⬜ 待开始
- **目录**:
  - `packages/ui-panel/` (空壳)
  - `apps/terre-addon/` (占位)
  - `apps/dev-sandbox/` (占位)

### 3.3 统一 @types/node 版本
- **状态**: ⬜ 待开始
- **当前**: ^20.0.0
- **官方 terre2**: ^16.0.0
- **决策**: 保持 ^20 或降级到 ^16

---

## 进度追踪

| 任务 | 优先级 | 状态 | 备注 |
|------|--------|------|------|
| 1.1 engines/packageManager | P1 | ✅ | 已添加 |
| 1.2 ESLint 配置 | P1 | ✅ | .eslintrc.js + 依赖 |
| 1.3 Prettier 配置 | P1 | ✅ | 添加 endOfLine 等 |
| 1.4 CI 评估 | P1 | ✅ | 结论: 暂不需要 |
| 2.1 TypeScript 升级 | P2 | ✅ | 5.0→5.8.3 |
| 2.2 完善 scripts | P2 | ✅ | build/lint/test/clean/format |
| 3.1 Changesets 清理 | P3 | ⬜ | |
| 3.2 占位目录清理 | P3 | ⬜ | |
| 3.3 @types/node 统一 | P3 | ⬜ | |

---

## 参考资料

- WebGAL_Terre/package.json: engines, packageManager
- WebGAL_Terre/packages/terre2/.eslintrc.js: ESLint 配置模板
- WebGAL_Terre/packages/terre2/.prettierrc: Prettier 配置
- TypeScript 5.8 Release Notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8