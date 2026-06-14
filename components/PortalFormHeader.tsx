// =====================================================================
// PortalFormHeader — shared header for the public self-service portals
// (owner / tenant / vendor). Maia logo on the left; a "Compliance Module ·
// Action needed" status chip on the right so the recipient sees up front
// that something needs their attention. Server-safe (no hooks).
// =====================================================================

export default function PortalFormHeader({ actionNeeded = true }: { actionNeeded?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/maia-logo-primary.svg" alt="Maia by PMI Top Florida Properties" style={{ height: 38, display: 'block' }} />
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af' }}>Compliance Module</div>
        {actionNeeded ? (
          <div style={{ marginTop: 3, display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '2px 8px' }}>⚠ Action needed</div>
        ) : (
          <div style={{ marginTop: 3, display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '2px 8px' }}>✓ All set</div>
        )}
      </div>
    </div>
  )
}
