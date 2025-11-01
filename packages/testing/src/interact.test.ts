/**
 * 交互工具测试（占位实现）
 */

import { WebGALAgentTools } from '@webgal-agent/agent-core/tools';
import { DEFAULT_SANDBOX_CONFIG } from '@webgal-agent/tool-bridge';
import {
  createTestProject,
  cleanupTestProject,
  assert,
  assertEqual,
  assertOnlyKeys,
  TestRunner,
} from './test-utils.js';

const runner = new TestRunner();

runner.test('ask_followup_question: should return ack', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.askFollowupQuestion({
      question: 'Test question?',
    });
    
    assertOnlyKeys(result, ['ack'], 'ask_followup_question response');
    assertEqual(result.ack, true);
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

runner.test('attempt_completion: should return ack', async () => {
  const projectRoot = await createTestProject();
  
  try {
    const tools = new WebGALAgentTools({
      projectRoot,
      sandbox: { ...DEFAULT_SANDBOX_CONFIG, projectRoot },
    });

    const result = await tools.attemptCompletion({
      result: 'Task completed',
    });
    
    assertOnlyKeys(result, ['ack'], 'attempt_completion response');
    assertEqual(result.ack, true);
  } finally {
    await cleanupTestProject(projectRoot);
  }
});

export { runner };

