'use client'

// =====================================================================
// components/SignatureEvidence.tsx
//
// Two small reusable UI pieces for the apply form's rules-signature
// step:
//
//   <SignaturePad /> — HTML canvas the applicant draws their
//   signature on (mouse + touch). onChange returns a PNG data URL
//   when the canvas has any strokes, or null when blank/cleared.
//
//   <WebcamCapture /> — opens the camera (with permission), shows a
//   live preview, and on "Take photo" captures a frame as a PNG data
//   URL. Skip button for applicants who decline or don't have a
//   camera; nothing is required.
//
// Kept self-contained — no external dependencies. Use natively on
// any apply-form-style step.
// =====================================================================

import { useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────
// SignaturePad
// ─────────────────────────────────────────────────────────────────────

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void
  clearLabel?: string
  placeholder?: string
}

export function SignaturePad({ onChange, clearLabel = 'Clear', placeholder = 'Draw your signature here' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hasInk, setHasInk] = useState(false)

  // Initialize the canvas at its CSS-pixel size scaled by devicePixelRatio
  // so strokes look crisp on retina displays. Re-run on mount only —
  // resizing the window mid-signature is a non-goal.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const rect = c.getBoundingClientRect()
    c.width = rect.width * dpr
    c.height = rect.height * dpr
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.strokeStyle = '#0d0d0d'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }
  }, [])

  // Pointer handling — works for mouse, touch, pen via the PointerEvent
  // unified API.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return

    let drawing = false
    function pos(e: PointerEvent) {
      if (!c) return { x: 0, y: 0 }
      const r = c.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    function down(e: PointerEvent) {
      if (!c || !ctx) return
      drawing = true
      ;(c as Element).setPointerCapture(e.pointerId)
      const { x, y } = pos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
    function move(e: PointerEvent) {
      if (!drawing || !ctx) return
      const { x, y } = pos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    function up() {
      if (!drawing) return
      drawing = false
      if (!c) return
      // canvas has ink — push the data URL up to the form
      const ink = c.toDataURL('image/png')
      setHasInk(true)
      onChange(ink)
    }

    c.addEventListener('pointerdown', down)
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    return () => {
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('pointercancel', up)
    }
  }, [onChange])

  function clear() {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = '#0d0d0d'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    setHasInk(false)
    onChange(null)
  }

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width:        '100%',
          height:       150,
          border:       hasInk ? '1.5px solid #16a34a' : '1.5px solid #d1d5db',
          borderRadius: 3,
          background:   '#fff',
          touchAction:  'none',  // critical: stops mobile scroll while drawing
          display:      'block',
        }}
      />
      {!hasInk && (
        <div style={{ position: 'absolute', top: 60, left: 0, right: 0, textAlign: 'center', pointerEvents: 'none', fontSize: 12, color: '#9ca3af', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {placeholder}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          style={{ fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', color: hasInk ? '#6b7280' : '#d1d5db', background: 'none', border: 'none', padding: '2px 6px', cursor: hasInk ? 'pointer' : 'default' }}
        >
          {clearLabel}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// WebcamCapture
// ─────────────────────────────────────────────────────────────────────

interface WebcamCaptureProps {
  onCapture: (dataUrl: string | null) => void
  startLabel?: string
  retakeLabel?: string
  skipLabel?: string
  captureLabel?: string
}

export function WebcamCapture({
  onCapture,
  startLabel = 'Enable camera',
  retakeLabel = 'Retake',
  skipLabel = 'Skip — no camera',
  captureLabel = 'Take photo',
}: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Tear the stream down when the component unmounts so the camera
  // light doesn't stay on. Cameras stuck "active" after a form close
  // is the #1 webcam UX complaint.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [stream])

  async function enable() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: false,
      })
      setStream(s)
      if (videoRef.current) {
        videoRef.current.srcObject = s
        await videoRef.current.play().catch(() => {})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not access camera')
    } finally {
      setBusy(false)
    }
  }

  function capture() {
    const v = videoRef.current
    if (!v) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0)
    const data = canvas.toDataURL('image/jpeg', 0.85)
    setPhoto(data)
    onCapture(data)
    // Stop the camera now that we have the still — courteous use of
    // the user's webcam and turns the privacy LED off.
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
  }

  function retake() {
    setPhoto(null)
    onCapture(null)
    enable()
  }

  function skip() {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setPhoto(null)
    onCapture(null)
  }

  // ── States: photo > stream > error > idle ─────────────────────────
  if (photo) {
    return (
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="Captured" style={{ width: '100%', maxWidth: 320, borderRadius: 3, border: '1.5px solid #16a34a' }} />
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={retake}
            style={{ fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '4px 10px', cursor: 'pointer' }}
          >
            {retakeLabel}
          </button>
        </div>
      </div>
    )
  }

  if (stream) {
    return (
      <div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', maxWidth: 320, borderRadius: 3, border: '1.5px solid #d1d5db', background: '#000' }}
        />
        <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={capture}
            style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', color: '#fff', background: '#f26a1b', border: 'none', borderRadius: 3, padding: '6px 12px', cursor: 'pointer' }}
          >
            📸 {captureLabel}
          </button>
          <button
            type="button"
            onClick={skip}
            style={{ fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', color: '#6b7280', background: 'none', border: '1px solid #d1d5db', borderRadius: 3, padding: '6px 12px', cursor: 'pointer' }}
          >
            {skipLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', color: '#f26a1b', background: 'none', border: '1.5px solid #f26a1b', borderRadius: 3, padding: '8px 14px', cursor: 'pointer' }}
      >
        {busy ? '…' : `📷 ${startLabel}`}
      </button>{' '}
      <button
        type="button"
        onClick={skip}
        style={{ fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', color: '#6b7280', background: 'none', border: 'none', padding: '8px 6px', cursor: 'pointer' }}
      >
        {skipLabel}
      </button>
      {error && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#b91c1c' }}>
          {error}
        </div>
      )}
    </div>
  )
}
