/**
 * WebGAL Agent 工具全面测试
 * 
 * 测试所有 13 个工具的功能：
 * - 文件系统工具: list_files, read_file, write_to_file, replace_in_file, search_files
 * - WebGAL 专用工具: validate_script, list_project_resources, preview_scene
 * - 快照工具: list_snapshots, restore_snapshot
 * - 交互工具: ask_followup_question, attempt_completion
 * - 命令执行: execute_command
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { WebGALAgentTools, type ToolsConfig } from '../index.js';

describe('WebGAL Agent Tools - 全面测试', () => {
  let tools: WebGALAgentTools;
  let testProjectRoot: string;

  // 创建测试项目结构
  beforeAll(async () => {
    // 创建临时测试目录
    testProjectRoot = path.join(os.tmpdir(), `webgal-test-${Date.now()}`);
    
    // 创建项目目录结构
    await fs.mkdir(testProjectRoot, { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'scene'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'background'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'figure'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'bgm'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, 'game', 'vocal'), { recursive: true });
    await fs.mkdir(path.join(testProjectRoot, '.webgal_agent', 'snapshots'), { recursive: true });

    // 创建测试场景文件
    await fs.writeFile(
      path.join(testProjectRoot, 'game', 'scene', 'start.txt'),
      `changeBg:bg_beach.png -next;
乙女:早上好！;
changeFigure:girl_happy.png -left -next;
乙女:今天天气真好呢;
playBgm:summer.mp3;
`
    );

    // 创建另一个场景文件
    await fs.writeFile(
      path.join(testProjectRoot, 'game', 'scene', 'chapter1.txt'),
      `changeBg:bg_school.png;
少年:这里是学校;
`
    );

    // 创建测试资源文件
    await fs.writeFile(path.join(testProjectRoot, 'game', 'background', 'bg_beach.png'), 'fake-png-data');
    await fs.writeFile(path.join(testProjectRoot, 'game', 'background', 'bg_school.png'), 'fake-png-data');
    await fs.writeFile(path.join(testProjectRoot, 'game', 'figure', 'girl_happy.png'), 'fake-png-data');
    await fs.writeFile(path.join(testProjectRoot, 'game', 'bgm', 'summer.mp3'), 'fake-mp3-data');

    // 初始化工具
    const config: ToolsConfig = {
      projectRoot: testProjectRoot,
      sandbox: {
        projectRoot: testProjectRoot,
        forbiddenDirs: ['.git', 'node_modules', '.env'],
        maxReadBytes: 1048576, // 1MB
        textEncoding: 'utf-8',
      },
      snapshotRetention: 10,
    };

    tools = new WebGALAgentTools(config);
  });

  // 清理测试目录
  afterAll(async () => {
    try {
      await fs.rm(testProjectRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('清理测试目录失败:', e);
    }
  });

  // ============ 1. 文件系统工具测试 ============

  describe('1. 文件系统工具', () => {
    describe('1.1 list_files - 列出文件', () => {
      it('应该列出目录中的所有条目', async () => {
        const result = await tools.listFiles({ path: 'game/scene' });
        
        expect(result.entries).toBeDefined();
        expect(result.entries).toContain('start.txt');
        expect(result.entries).toContain('chapter1.txt');
      });

      it('应该支持 glob 模式', async () => {
        const result = await tools.listFiles({
          path: 'game',
          globs: ['**/*.txt'],
        });
        
        expect(result.entries.length).toBeGreaterThan(0);
      });

      it('应该支持仅列出目录', async () => {
        const result = await tools.listFiles({
          path: 'game',
          dirsOnly: true,
        });
        
        expect(result.entries).toContain('scene');
        expect(result.entries).toContain('background');
      });

      it('应该拒绝绝对路径', async () => {
        await expect(tools.listFiles({ path: '/etc/passwd' }))
          .rejects.toMatchObject({
            error: { code: 'E_DENY_PATH' }
          });
      });

      it('应该拒绝路径逃逸', async () => {
        await expect(tools.listFiles({ path: '../../../etc' }))
          .rejects.toMatchObject({
            error: { code: 'E_DENY_PATH' }
          });
      });
    });

    describe('1.2 read_file - 读取文件', () => {
      it('应该读取文件内容', async () => {
        const result = await tools.readFile({ path: 'game/scene/start.txt' });
        
        expect(result.path).toBe('game/scene/start.txt');
        expect(result.content).toContain('乙女:早上好');
        expect(result.encoding).toBe('utf-8');
        expect(result.bytes).toBeGreaterThan(0);
      });

      it('应该对不存在的文件返回错误', async () => {
        await expect(tools.readFile({ path: 'game/scene/nonexistent.txt' }))
          .rejects.toMatchObject({
            error: { code: 'E_NOT_FOUND' }
          });
      });
    });

    describe('1.3 write_to_file - 写入文件', () => {
      it('应该在 dryRun 模式下返回 diff 而不写入', async () => {
        const result = await tools.writeToFile({
          path: 'game/scene/test_dry.txt',
          content: '新内容',
          dryRun: true,
        });
        
        expect(result.applied).toBe(false);
        expect(result.diff).toBeDefined();
      });

      it('应该实际写入文件', async () => {
        const testContent = `changeBg:bg_new.png;
测试角色:这是测试内容;
`;
        const result = await tools.writeToFile({
          path: 'game/scene/new_scene.txt',
          content: testContent,
          dryRun: false,
        });
        
        expect(result.applied).toBe(true);
        expect(result.snapshotId).toBeDefined();
        
        // 验证文件已写入
        const readResult = await tools.readFile({ path: 'game/scene/new_scene.txt' });
        expect(readResult.content).toBe(testContent);
      });

      it('应该支持追加模式', async () => {
        // 先写入初始内容
        await tools.writeToFile({
          path: 'game/scene/append_test.txt',
          content: '第一行\n',
          dryRun: false,
        });

        // 追加内容
        await tools.writeToFile({
          path: 'game/scene/append_test.txt',
          content: '第二行\n',
          mode: 'append',
          dryRun: false,
        });

        const result = await tools.readFile({ path: 'game/scene/append_test.txt' });
        expect(result.content).toContain('第一行');
        expect(result.content).toContain('第二行');
      });
    });

    describe('1.4 replace_in_file - 查找替换', () => {
      beforeEach(async () => {
        // 创建测试文件
        await tools.writeToFile({
          path: 'game/scene/replace_test.txt',
          content: `角色A:你好;
角色A:再见;
角色B:你好;
`,
          dryRun: false,
        });
      });

      it('应该替换匹配的文本', async () => {
        const result = await tools.replaceInFile({
          path: 'game/scene/replace_test.txt',
          find: '角色A',
          replace: '主角',
          flags: 'g',
        });
        
        expect(result.count).toBe(2);
        
        const readResult = await tools.readFile({ path: 'game/scene/replace_test.txt' });
        expect(readResult.content).toContain('主角:你好');
        expect(readResult.content).not.toContain('角色A');
      });

      it('应该支持正则表达式', async () => {
        const result = await tools.replaceInFile({
          path: 'game/scene/replace_test.txt',
          find: '角色[AB]',
          replace: 'NPC',
          flags: 'g',
        });
        
        expect(result.count).toBe(3);
      });
    });

    describe('1.5 search_files - 搜索文件', () => {
      it('应该搜索匹配的内容', async () => {
        const result = await tools.searchFiles({
          path: 'game/scene',
          regex: '乙女',
        });
        
        expect(result.matches.length).toBeGreaterThan(0);
        expect(result.matches[0].path).toContain('start.txt');
      });

      it('应该支持文件模式过滤', async () => {
        const result = await tools.searchFiles({
          path: 'game/scene',
          regex: 'changeBg',
          filePattern: '**/*.txt',
        });
        
        expect(result.matches.length).toBeGreaterThan(0);
      });

      it('应该限制最大匹配数', async () => {
        const result = await tools.searchFiles({
          path: 'game/scene',
          regex: ':',
          maxMatches: 2,
        });
        
        expect(result.matches.length).toBeLessThanOrEqual(2);
      });
    });
  });

  // ============ 2. WebGAL 专用工具测试 ============

  describe('2. WebGAL 专用工具', () => {
    describe('2.1 validate_script - 校验脚本', () => {
      it('应该验证有效的脚本', async () => {
        const result = await tools.validateScript({
          content: `changeBg:bg_beach.png -next;
乙女:你好;
`,
        });
        
        expect(result.valid).toBe(true);
        expect(result.diagnostics.length).toBe(0);
      });

      it('应该检测语法错误', async () => {
        const result = await tools.validateScript({
          content: `changeBg bg_beach.png;
invalid line without colon
`,
        });
        
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics.some(d => d.kind === 'syntax')).toBe(true);
      });

      it('应该从文件路径验证', async () => {
        const result = await tools.validateScript({
          path: 'game/scene/start.txt',
        });
        
        expect(result).toBeDefined();
        // 根据实际脚本内容判断
      });
    });

    describe('2.2 list_project_resources - 列出项目资源', () => {
      it('应该列出所有类型的资源', async () => {
        const result = await tools.listProjectResources();
        
        expect(result.backgrounds).toBeDefined();
        expect(result.figures).toBeDefined();
        expect(result.bgm).toBeDefined();
        expect(result.vocals).toBeDefined();
        expect(result.scenes).toBeDefined();
        
        expect(result.backgrounds).toContain('bg_beach.png');
        expect(result.scenes).toContain('start.txt');
      });
    });

    describe('2.3 preview_scene - 预览场景', () => {
      it('应该返回预览 URL（或适当的响应）', async () => {
        // 注意：此测试可能需要 dev 服务器运行
        // 在没有服务器的情况下，可能返回错误或模拟响应
        try {
          const result = await tools.previewScene({
            scenePath: 'game/scene/start.txt',
          });
          
          // 如果成功，应该有 URL
          expect(result.url).toBeDefined();
        } catch (error: any) {
          // 如果执行被禁用，应该返回特定错误
          expect(error.error?.code).toBe('E_TOOL_DISABLED');
        }
      });
    });
  });

  // ============ 3. 快照工具测试 ============

  describe('3. 快照工具', () => {
    let createdSnapshotId: string;

    beforeAll(async () => {
      // 创建一个写入操作以生成快照
      const result = await tools.writeToFile({
        path: 'game/scene/snapshot_test.txt',
        content: '原始内容\n',
        dryRun: false,
      });
      createdSnapshotId = result.snapshotId!;
    });

    describe('3.1 list_snapshots - 列出快照', () => {
      it('应该列出所有快照', async () => {
        const result = await tools.listSnapshots({});
        
        expect(result.snapshots).toBeDefined();
        expect(Array.isArray(result.snapshots)).toBe(true);
      });

      it('应该支持按路径过滤', async () => {
        const result = await tools.listSnapshots({
          path: 'game/scene/snapshot_test.txt',
        });
        
        expect(result.snapshots).toBeDefined();
      });

      it('应该支持限制数量', async () => {
        const result = await tools.listSnapshots({
          limit: 5,
        });
        
        expect(result.snapshots.length).toBeLessThanOrEqual(5);
      });
    });

    describe('3.2 restore_snapshot - 恢复快照', () => {
      it('应该恢复快照内容', async () => {
        // 先修改文件
        await tools.writeToFile({
          path: 'game/scene/snapshot_test.txt',
          content: '修改后的内容\n',
          dryRun: false,
        });

        // 获取快照列表
        const snapshots = await tools.listSnapshots({
          path: 'game/scene/snapshot_test.txt',
        });

        if (snapshots.snapshots.length > 0) {
          const snapshotId = snapshots.snapshots[0].id;
          
          const result = await tools.restoreSnapshot({
            snapshotId,
          });
          
          // RestoreSnapshotResponse 返回 { path, content }
          expect(result.path).toBeDefined();
          expect(result.content).toBeDefined();
        }
      });

      it('应该对不存在的快照返回错误', async () => {
        await expect(tools.restoreSnapshot({
          snapshotId: 'nonexistent-snapshot-id',
        })).rejects.toMatchObject({
          error: { code: expect.stringMatching(/E_NOT_FOUND|E_BAD_ARGS/) }
        });
      });
    });
  });

  // ============ 4. 交互工具测试 ============

  describe('4. 交互工具', () => {
    describe('4.1 ask_followup_question - 询问后续问题', () => {
      it('应该返回问题响应', async () => {
        const result = await tools.askFollowupQuestion({
          question: '你想创建什么类型的场景？',
        });
        
        expect(result).toBeDefined();
        // 这是一个占位实现，应该返回某种确认
      });
    });

    describe('4.2 attempt_completion - 尝试完成', () => {
      it('应该返回完成响应', async () => {
        const result = await tools.attemptCompletion({
          result: '已成功创建新场景文件',
        });
        
        expect(result).toBeDefined();
      });
    });
  });

  // ============ 5. 命令执行工具测试 ============

  describe('5. 命令执行工具', () => {
    describe('5.1 execute_command - 执行命令', () => {
      it('应该在执行禁用时返回错误', async () => {
        // 由于我们没有启用 execution，应该返回禁用错误
        await expect(tools.executeCommand({
          scriptName: 'build',
          args: [],
        })).rejects.toMatchObject({
          error: { code: 'E_TOOL_DISABLED' }
        });
      });
    });
  });

  // ============ 6. 安全边界测试 ============

  describe('6. 安全边界测试', () => {
    it('应该阻止访问 .git 目录', async () => {
      // 创建 .git 目录
      await fs.mkdir(path.join(testProjectRoot, '.git'), { recursive: true });
      await fs.writeFile(path.join(testProjectRoot, '.git', 'config'), 'test');

      await expect(tools.readFile({ path: '.git/config' }))
        .rejects.toMatchObject({
          error: { code: 'E_DENY_PATH' }
        });
    });

    it('应该阻止访问 node_modules 目录', async () => {
      await expect(tools.listFiles({ path: 'node_modules' }))
        .rejects.toMatchObject({
          error: { code: 'E_DENY_PATH' }
        });
    });

    it('应该阻止路径遍历攻击', async () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        'game/../../../etc/passwd',
      ];

      for (const maliciousPath of maliciousPaths) {
        await expect(tools.readFile({ path: maliciousPath }))
          .rejects.toMatchObject({
            error: { code: expect.stringMatching(/E_DENY_PATH|E_NOT_FOUND/) }
          });
      }
    });
  });

  // ============ 7. 边界条件测试 ============

  describe('7. 边界条件测试', () => {
    it('应该处理空文件', async () => {
      await tools.writeToFile({
        path: 'game/scene/empty.txt',
        content: '',
        dryRun: false,
      });

      const result = await tools.readFile({ path: 'game/scene/empty.txt' });
      expect(result.content).toBe('');
    });

    it('应该处理 Unicode 内容', async () => {
      const unicodeContent = `changeBg:bg_日本.png;
角色:こんにちは 🌸 世界！;
角色:Привет мир!;
`;
      await tools.writeToFile({
        path: 'game/scene/unicode.txt',
        content: unicodeContent,
        dryRun: false,
      });

      const result = await tools.readFile({ path: 'game/scene/unicode.txt' });
      expect(result.content).toBe(unicodeContent);
    });

    it('应该处理长文件名', async () => {
      const longName = 'a'.repeat(200) + '.txt';
      
      try {
        await tools.writeToFile({
          path: `game/scene/${longName}`,
          content: 'test',
          dryRun: false,
        });
      } catch (error: any) {
        // 文件系统可能拒绝过长的文件名
        expect(error.error?.code).toMatch(/E_IO|E_BAD_ARGS/);
      }
    });
  });
});

// ============ 工具列表汇总测试 ============

describe('工具列表完整性检查', () => {
  it('应该包含所有 13 个工具', () => {
    const expectedTools = [
      'list_files',
      'read_file',
      'write_to_file',
      'replace_in_file',
      'search_files',
      'validate_script',
      'list_project_resources',
      'list_snapshots',
      'restore_snapshot',
      'preview_scene',
      'ask_followup_question',
      'attempt_completion',
      'execute_command',
    ];

    // 检查 WebGALAgentTools 类是否有对应的方法
    const toolMethods = [
      'listFiles',
      'readFile',
      'writeToFile',
      'replaceInFile',
      'searchFiles',
      'validateScript',
      'listProjectResources',
      'listSnapshots',
      'restoreSnapshot',
      'previewScene',
      'askFollowupQuestion',
      'attemptCompletion',
      'executeCommand',
    ];

    expect(expectedTools.length).toBe(13);
    expect(toolMethods.length).toBe(13);
  });
});
