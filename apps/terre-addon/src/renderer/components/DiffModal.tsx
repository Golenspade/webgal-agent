import type { Diff } from '@webgal-agent/agent-core/types'
import React from 'react'

interface DiffModalProps {
  open: boolean
  diff: Diff | null
  onClose?: () => void
}

export function DiffModal({ open, diff, onClose }: DiffModalProps) {
  if (!open || !diff) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }} onClick={onClose}>
      <div style={{ background: '#fff', minWidth: 720, maxWidth: '90%', maxHeight: '80%', overflow: 'auto', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
          <strong>Diff 预览</strong>
          <button onClick={onClose}>关闭</button>
        </div>
        <div style={{ padding: 16 }}>
          {diff.hunks.length === 0 && <div>无差异</div>}
          {diff.hunks.map((h, idx) => (
            <div key={idx} style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: 'monospace', color: '#666', marginBottom: 8 }}>
                @@ -{h.startOld},{h.lenOld} +{h.startNew},{h.lenNew} @@
              </div>
              <div style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}>
                {h.linesOld.map((line, i) => (
                  <div key={`o-${i}`} style={{ color: '#b00020' }}>- {line}</div>
                ))}
                {h.linesNew.map((line, i) => (
                  <div key={`n-${i}`} style={{ color: '#1a7f37' }}>+ {line}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
