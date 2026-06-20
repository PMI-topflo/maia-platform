'use client'

// A topbar "Ask MAIA →" affordance that opens the floating MAIA chat widget
// (MaiaWidget listens for the `maia:open` event). Lets the header CTA actually
// do something instead of being decorative text.

export default function AskMaiaButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('maia:open'))}
      className={className}
      style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0 }}
    >
      {label}
    </button>
  )
}
