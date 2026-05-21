// =====================================================================
// app/admin/tickets/[id]/components/WorkOrderPhotos.tsx
//
// Thumbnail grid + click-to-zoom lightbox for work-order attachments.
// Pulls from /api/admin/work-orders/[id]/photos which mirrors CINC-side
// vendor photos into Supabase on first view.
// =====================================================================

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Attachment {
  id:                 string
  source:             'cinc' | 'email' | 'staff_upload'
  filename:           string
  mime_type:          string
  file_size_bytes:    number
  signed_url:         string
  cinc_created_date:  string | null
  created_at:         string
}

interface PhotosResponse {
  attachments:  Attachment[]
  sync:         { mirrored: number; skipped: number; errors: string[] } | null
  has_cinc_id:  boolean
}

interface Props {
  ticketId:            number
  hasCincWorkOrderId:  boolean
}

const SOURCE_LABEL: Record<Attachment['source'], string> = {
  cinc:         'from CINC',
  email:        'from email',
  staff_upload: 'uploaded',
}

export default function WorkOrderPhotos({ ticketId, hasCincWorkOrderId }: Props) {
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [busyDelete,  setBusyDelete]  = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchPhotos = useCallback(async (forceRefresh: boolean) => {
    if (forceRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/work-orders/${ticketId}/photos${forceRefresh ? '?refresh=1' : ''}`,
        { cache: 'no-store' },
      )
      const json = await res.json() as PhotosResponse | { error: string }
      if (!res.ok) {
        setError('error' in json ? json.error : `HTTP ${res.status}`)
        return
      }
      const data = json as PhotosResponse
      setAttachments(data.attachments ?? [])
      if (data.sync?.errors?.length) {
        setError(`Sync warnings: ${data.sync.errors.join('; ')}`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [ticketId])

  useEffect(() => {
    void fetchPhotos(false)
  }, [fetchPhotos])

  // Direct staff upload — three steps per file: get a signed URL, PUT
  // the bytes straight to Supabase Storage (bypasses Vercel's 4.5 MB
  // body limit so full-resolution phone photos go through), then POST
  // the metadata so MAIA records the work_order_attachments row.
  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of files) {
        const urlRes = await fetch(`/api/admin/work-orders/${ticketId}/photos/upload-url`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ filename: file.name }),
        })
        const urlData = await urlRes.json()
        if (!urlRes.ok) throw new Error(urlData?.error ?? 'Could not get an upload URL')

        const putRes = await fetch(urlData.signed_url, {
          method:  'PUT',
          body:    file,
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
        })
        if (!putRes.ok) {
          let detail = `HTTP ${putRes.status}`
          try {
            const j = await putRes.json() as { message?: string; error?: string }
            detail = j?.message ?? j?.error ?? detail
          } catch { /* keep status line */ }
          throw new Error(`Upload failed for ${file.name}: ${detail}`)
        }

        const metaRes = await fetch(`/api/admin/work-orders/${ticketId}/photos`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            storage_path:    urlData.storage_path,
            filename:        file.name,
            mime_type:       file.type || undefined,
            file_size_bytes: file.size,
          }),
        })
        const metaData = await metaRes.json()
        if (!metaRes.ok) throw new Error(metaData?.error ?? `Could not save ${file.name}`)
        setAttachments(metaData.attachments ?? [])
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }, [ticketId])

  const deletePhoto = useCallback(async (attachmentId: string) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    setBusyDelete(attachmentId)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/work-orders/${ticketId}/photos?attachmentId=${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Delete failed')
      setAttachments(data.attachments ?? [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyDelete(null)
    }
  }, [ticketId])

  // Lightbox: ESC closes, arrow keys navigate
  useEffect(() => {
    if (lightboxIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null)
      else if (e.key === 'ArrowRight' && lightboxIdx < attachments.length - 1) setLightboxIdx(lightboxIdx + 1)
      else if (e.key === 'ArrowLeft'  && lightboxIdx > 0)                      setLightboxIdx(lightboxIdx - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, attachments.length])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Photos</h3>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''   // let the same file be picked again
              void uploadFiles(files)
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-[#f26a1b] hover:text-[#d85a14] disabled:text-gray-400"
            title="Upload photos from this device"
          >
            {uploading ? 'Uploading…' : '+ Add photos'}
          </button>
          {hasCincWorkOrderId && (
            <button
              onClick={() => void fetchPhotos(true)}
              disabled={refreshing || loading}
              className="text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400"
              title="Re-pull from CINC and add any new photos"
            >
              {refreshing ? 'Refreshing…' : 'Refresh from CINC'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-xs text-gray-500">Loading photos…</div>
      )}

      {!loading && error && (
        <div className="text-xs text-red-600 break-words">{error}</div>
      )}

      {!loading && !error && attachments.length === 0 && (
        <div className="text-xs text-gray-500">
          No photos yet. Use <span className="font-medium text-[#f26a1b]">+ Add photos</span> to upload from this device.
          {hasCincWorkOrderId && ' Vendor-attached photos in CINC also appear here.'}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {attachments.map((att, idx) => (
            <div
              key={att.id}
              className="group relative aspect-square overflow-hidden rounded border border-gray-200 bg-gray-50 hover:border-blue-400"
            >
              <button
                onClick={() => setLightboxIdx(idx)}
                className="block h-full w-full focus:outline-none focus:ring-2 focus:ring-blue-400"
                title={`${att.filename} — ${SOURCE_LABEL[att.source]}`}
              >
                <img
                  src={att.signed_url}
                  alt={att.filename}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
              </button>
              {att.source !== 'cinc' && (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white">
                  {SOURCE_LABEL[att.source]}
                </span>
              )}
              {att.source !== 'cinc' && (
                <button
                  onClick={() => void deletePhoto(att.id)}
                  disabled={busyDelete === att.id}
                  title="Delete this photo"
                  className="absolute top-1 right-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-sm text-white hover:bg-red-600 group-hover:flex disabled:opacity-50"
                >
                  {busyDelete === att.id ? '…' : '×'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightboxIdx !== null && attachments[lightboxIdx] && (
        <Lightbox
          attachments={attachments}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onPrev={() => setLightboxIdx(i => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIdx(i => (i !== null && i < attachments.length - 1 ? i + 1 : i))}
        />
      )}
    </div>
  )
}

function Lightbox({
  attachments,
  index,
  onClose,
  onPrev,
  onNext,
}: {
  attachments: Attachment[]
  index:       number
  onClose:     () => void
  onPrev:      () => void
  onNext:      () => void
}) {
  const att     = attachments[index]
  const hasPrev = index > 0
  const hasNext = index < attachments.length - 1

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="absolute top-4 right-4 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
        aria-label="Close"
      >
        Close ✕
      </button>

      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-2xl text-white hover:bg-white/20"
          aria-label="Previous"
        >
          ‹
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext() }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-2xl text-white hover:bg-white/20"
          aria-label="Next"
        >
          ›
        </button>
      )}

      <img
        src={att.signed_url}
        alt={att.filename}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] max-w-[88vw] object-contain"
      />

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs text-white">
        {att.filename} · {(att.file_size_bytes / 1024).toFixed(0)} KB · {index + 1} of {attachments.length}
      </div>
    </div>
  )
}
