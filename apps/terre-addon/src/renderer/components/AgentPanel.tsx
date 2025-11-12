import React, { useEffect, useMemo, useState } from 'react'
import { agentClient } from '../api/agent-client'
import type { Diff, Diagnostic, ListFilesResponse, ListProjectResourcesResponse } from '@webgal-agent/agent-core/types'
import { DiffModal } from './DiffModal'
import { SnapshotRevert } from './SnapshotRevert'

type Status = {
  running: boolean
  projectRoot: string | null
  tools: Array<{ name: string; description?: string }>
  previewPort: number
}

export function AgentPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [projectRoot, setProjectRoot] = useState('')
  const [scenes, setScenes] = useState<ListFilesResponse | null>(null)
  const [currentScene, setCurrentScene] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [diff, setDiff] = useState<Diff | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [resources, setResources] = useState<ListProjectResourcesResponse | null>(null)

  const previewUrl = useMemo(() => {
    if (!currentScene) return ''
    const scenePath = `game/scene/${currentScene}`
    return `http://localhost:${status?.previewPort || 3001}#scene=${scenePath.replace(/^.*\//, '').replace(/\.txt$/, '')}`
  }, [currentScene, status?.previewPort])

  const refreshStatus = async () => {
    try {
      const s = await agentClient.getStatus()
      setStatus(s)
      if (s.projectRoot && !projectRoot) setProjectRoot(s.projectRoot)
    } catch (e: any) {
      setStatus({ running: false, projectRoot: null, tools: [], previewPort: 3001 })
    }
  }

  useEffect(() => {
    refreshStatus()
  }, [])

  const startAgent = async () => {
    setError(null)
    try {
      await agentClient.setProjectRoot(projectRoot || '.', {})
      await refreshStatus()
      await loadScenes()
      await loadResources()
    } catch (e: any) {
      setError(e?.message || '启动失败')
    }
  }

  const stopAgent = async () => {
    setError(null)
    try {
      await agentClient.stop()
      await refreshStatus()
    } catch (e: any) {
      setError(e?.message || '停止失败')
    }
  }

  const loadScenes = async () => {
    setError(null)
    try {
      const res = await agentClient.listScenes()
      setScenes(res)
    } catch (e: any) {
      setError(e?.message || '加载场景失败')
    }
  }

  const loadResources = async () => {
    try {
      const res = await agentClient.listProjectResources()
      setResources(res)
    } catch (e) {
      // ignore
    }
  }

  const openScene = async (file: string) => {
    setError(null)
    try {
      const data = await agentClient.readFile(`game/scene/${file}`)
      setCurrentScene(file)
      setContent(data.content)
      setDiagnostics([])
      setDiff(null)
    } catch (e: any) {
      setError(e?.message || '读取失败')
    }
  }

  const validate = async () => {
    if (!currentScene) return
    setValidating(true)
    setError(null)
    try {
      const res = await agentClient.validateScript({ path: `game/scene/${currentScene}` })
      setDiagnostics(res.diagnostics)
    } catch (e: any) {
      setError(e?.message || '校验失败')
    } finally {
      setValidating(false)
    }
  }

  const dryRun = async () => {
    if (!currentScene) return
    setError(null)
    try {
      const res = await agentClient.writeDryRun({ path: `game/scene/${currentScene}`, content })
      setDiff(res.diff)
      setShowDiff(true)
    } catch (e: any) {
      setError(e?.message || 'Dry‑run 失败')
    }
  }

  const apply = async () => {
    if (!currentScene) return
    setError(null)
    try {
      const res = await agentClient.writeApply({ path: `game/scene/${currentScene}`, content, idempotencyKey: `apply:${currentScene}` })
      alert(`写入成功，snapshotId: ${res.snapshotId}`)
      setShowDiff(false)
    } catch (e: any) {
      setError(e?.message || '写入失败')
    }
  }

  return (
    <div style={{ padding: 12, display: 'flex', gap: 12 }}>
      {/* 左侧：控制面板与资源 */}
      <div style={{ width: 340, flexShrink: 0 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Agent 控制台</strong>
            <span style={{ fontSize: 12, color: status?.running ? '#1a7f37' : '#b00020' }}>
              {status?.running ? '运行中' : '未运行'}
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>项目根目录</div>
            <input value={projectRoot} onChange={(e) => setProjectRoot(e.target.value)} placeholder="/path/to/webgal/project" style={{ width: '100%' }} />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={startAgent}>连接/启动</button>
            <button onClick={stopAgent} disabled={!status?.running}>停止</button>
            <button onClick={refreshStatus}>刷新</button>
          </div>
          {status?.running && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              预览地址： <a href={previewUrl} target="_blank" rel="noreferrer">{previewUrl || `http://localhost:${status?.previewPort || 3001}`}</a>
            </div>
          )}
          {error && <div style={{ marginTop: 8, color: '#b00020' }}>错误：{error}</div>}
        </div>

        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>资源清单</strong>
            <button onClick={loadResources}>刷新</button>
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>
            <div>背景：{resources?.backgrounds.length ?? 0}</div>
            <div>立绘：{resources?.figures.length ?? 0}</div>
            <div>BGM：{resources?.bgm.length ?? 0}</div>
            <div>语音：{resources?.vocals.length ?? 0}</div>
            <div>场景：{resources?.scenes.length ?? 0}</div>
          </div>
        </div>

        <SnapshotRevert />
      </div>

      {/* 右侧：场景 & 编辑区 */}
      <div style={{ flex: 1 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong>场景文件</strong>
            <button onClick={loadScenes}>刷新列表</button>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{ width: 240, maxHeight: 360, overflow: 'auto', borderRight: '1px solid #eee', paddingRight: 8 }}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {(scenes?.entries || []).filter(n => n.endsWith('.txt')).map(name => (
                  <li key={name}>
                    <button style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: currentScene === name ? '#eef6ff' : 'transparent',
                      border: 'none', padding: '6px 8px', borderRadius: 4
                    }} onClick={() => openScene(name)}>
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 'bold' }}>{currentScene || '未选择文件'}</div>
                  <div style={{ fontSize: 12, color: '#666' }}>编辑后可 Dry‑run 预览 Diff，再确认写入</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={validate} disabled={!currentScene || validating}>校验脚本</button>
                  <button onClick={dryRun} disabled={!currentScene}>Dry‑run</button>
                  <button onClick={apply} disabled={!currentScene}>Apply</button>
                </div>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder=":欢迎来到 WebGAL;\n"
                style={{ marginTop: 8, width: '100%', height: 320, fontFamily: 'monospace' }}
              />
              {!!diagnostics.length && (
                <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
                  <strong>校验结果</strong>
                  <ul>
                    {diagnostics.map((d, i) => (
                      <li key={i} style={{ color: d.kind === 'syntax' ? '#b00020' : '#8a6d3b' }}>
                        行 {d.line} [{d.kind}]：{d.message}{d.fixHint ? `（建议：${d.fixHint}）` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <DiffModal open={showDiff} diff={diff} onClose={() => setShowDiff(false)} />
    </div>
  )
}
