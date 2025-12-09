/**
 * 脚本校验测试
 */

import { WebGALAgentTools } from '@webgal-agent/agent-core/tools'
import { DEFAULT_SANDBOX_CONFIG } from '@webgal-agent/tool-bridge'
import {
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  assertOnlyKeys,
  TestRunner,
} from './test-utils.js'

const runner = new TestRunner()

runner.test('validate_script: should detect missing semicolons', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'changeBg: beach.jpg\n雪乃: 你好',
    })

    assertOnlyKeys(result, ['valid', 'diagnostics'], 'validate_script response')
    assertEqual(result.valid, false)
    assert(result.diagnostics.length >= 2, 'should have 2 diagnostics')
    assert(
      result.diagnostics.every((d) => d.kind === 'syntax'),
      'all should be syntax errors',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should detect unknown commands', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'unknownCmd: test;',
    })

    assertEqual(result.valid, false)
    assert(
      result.diagnostics.some((d) => d.kind === 'syntax' && d.message.includes('未知')),
      'should have unknown command error',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should not flag character dialogue as unknown command', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: '雪乃: 你好;',
    })

    // 角色台词不应被标记为未知指令
    const syntaxErrors = result.diagnostics.filter(
      (d) => d.kind === 'syntax' && d.message.includes('未知'),
    )
    assertEqual(syntaxErrors.length, 0, 'should not flag character dialogue')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should detect missing background', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'changeBg: nonexistent.jpg;',
    })

    assertEqual(result.valid, false)
    assert(
      result.diagnostics.some((d) => d.kind === 'resource'),
      'should have resource error',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should detect missing figure', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'changeFigure: missing.png;',
    })

    assertEqual(result.valid, false)
    assert(
      result.diagnostics.some((d) => d.kind === 'resource'),
      'should have resource error',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should detect missing BGM', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'bgm: missing.mp3;',
    })

    assertEqual(result.valid, false)
    assert(
      result.diagnostics.some((d) => d.kind === 'resource'),
      'should have resource error',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should detect missing vocal', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'playVocal: missing.mp3;',
    })

    assertEqual(result.valid, false)
    assert(
      result.diagnostics.some((d) => d.kind === 'resource'),
      'should have resource error',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should detect missing scene', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'changeScene: missing.txt;',
    })

    assertEqual(result.valid, false)
    assert(
      result.diagnostics.some((d) => d.kind === 'resource'),
      'should have resource error',
    )
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should allow "none" parameter', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: 'bgm: none;\nchangeFigure: none;',
    })

    // none 参数不应触发资源检查
    const resourceErrors = result.diagnostics.filter((d) => d.kind === 'resource')
    assertEqual(resourceErrors.length, 0, 'should not check "none" resources')
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

runner.test('validate_script: should pass valid script', async () => {
  const projectRoot = await createTestProject()

  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    })

    const result = await tools.validateScript({
      content: `changeBg: beach.jpg;
雪乃: 你好;
changeFigure: yukino.png;
bgm: beach_bgm.mp3;`,
    })

    assertEqual(result.valid, true)
    assertEqual(result.diagnostics.length, 0)
  } finally {
    await cleanupTestProject(projectRoot)
  }
})

export { runner }
