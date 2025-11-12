import React, { useEffect, useState } from 'react'
import { agentClient } from '../api/agent-client'
import type { SnapshotMetadata, Diff } from '@webgal-agent/agent-core/types'
import { DiffModal } from './DiffModal'

export function SnapshotRevert() {
  const [loading, setLoading] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [restoreInfo, setRestoreInfo] = useState<{ path: string; content: string } | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      setError(null)
      try {
        const { snapshots } = await agentClient.listSnapshots({ path: 'game/scene', limit: 20 })
        setSnapshots(snapshots)
      } catch (e: any) {
        setError(e?.message || '加载快照失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const onSelect = (id: string) => {
    setSelected(id)
    setRestoreInfo(null)
    setDiff(null)
  }

  const loadSnapshot = async () => {
    if (!selected) return
    setError(null)
    try {
      const data = await agentClient.restoreSnapshot(selected)
      setRestoreInfo({ path: data.path, content: data.content })
    } catch (e: any) {
      setError(e?.message || '读取快照失败')
    }
  }

  const previewRestore = async () => {
    if (!restoreInfo) return
    setError(null)
    try {
      const res = await agentClient.writeDryRun({ path: restoreInfo.path, content: restoreInfo.content })
      setDiff(res.diff)
      setShowDiff(true)
    } catch (e: any) {
      setError(e?.message || '预览失败')
    }
  }

  const applyRestore = async () => {
    if (!restoreInfo) return
    setError(null)
    try {
      await agentClient.writeApply({ path: restoreInfo.path, content: restoreInfo.content, idempotencyKey: `restore:${selected}` })
      setShowDiff(false)
      alert('已恢复并创建快照')
    } catch (e: any) {
      setError(e?.message || '应用失败')
    }
  }

  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>快照回滚</strong>
        {loading && <span style={{ color: '#999' }}>加载中…</span>}
      </div>
      {error && <div style={{ color: '#b00020', marginTop: 8 }}>错误：{error}</div>}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <select value={selected} onChange={(e) => onSelect(e.target.value)} style={{ flex: 1 }}>
          <option value="">选择一个快照…</option>
          {snapshots.map(s => (
            <option key={s.id} value={s.id}>
              {new Date(s.timestamp).toLocaleString()} — {s.id} — {s.path}
            </option>
          ))}
        </select>
        <button onClick={loadSnapshot} disabled={!selected}>读取</button>
      </div>
      {restoreInfo && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#666' }}>目标文件：{restoreInfo.path}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={previewRestore}>预览 Diff</button>
            <button onClick={applyRestore}>确认恢复</button>
          </div>
        </div>
      )}
      <DiffModal open={showDiff} diff={diff} onClose={() => setShowDiff(false)} />
    </div>
  )
}
