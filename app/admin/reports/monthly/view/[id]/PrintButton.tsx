'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="bg-[#f26a1b] text-white text-sm font-medium px-4 py-1.5 rounded hover:bg-[#d85a14]"
    >
      Print / Save as PDF
    </button>
  )
}
