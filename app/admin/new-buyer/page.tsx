'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Association } from '../actions'
import { useEffect } from 'react'

export default function NewBuyerPage() {
  const [associations, setAssociations] = useState<Association[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/buyer-notification/associations')
      .then(r => r.json())
      .then(setAssociations)
      .catch(() => {})
  }, [])

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)])
  }

  const removeFile = (i: number) => setFiles(f => f.filter((_, idx) => idx !== i))

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    files.forEach(f => formData.append('files', f))

    try {
      const res = await fetch('/api/buyer-notification', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Submission failed')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center max-w-md">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Buyer Notification Submitted</h2>
          <p className="text-gray-500 text-sm mb-6">The team has been notified and the buyer information has been saved.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { setSuccess(false); setFiles([]) }}
              className="text-sm px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Submit Another
            </button>
            <Link href="/admin" className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Dashboard</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-lg font-semibold text-gray-900">New Unit Buyer Notification</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8">
        <p className="text-sm text-gray-500 mb-6">
          Submit this form when a unit has been sold and a new buyer needs to be onboarded.
          The team will receive an email notification with all attached documents.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Unit / Association */}
          <Card title="Unit Information">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Association <Required /></Label>
                <select name="association_code" required className={INPUT}>
                  <option value="">— Select Association —</option>
                  {associations.map(a => (
                    <option key={a.association_code} value={a.association_code}>
                      {a.association_code} — {a.association_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Unit Number <Required /></Label>
                <input name="unit_number" type="text" required placeholder="e.g. 101A" className={INPUT} />
              </div>
              <div>
                <Label>Closing Date</Label>
                <input name="closing_date" type="date" className={INPUT} />
              </div>
              <div className="col-span-2">
                <Label>Property Address</Label>
                <input name="property_address" type="text" placeholder="123 Ocean Dr, Miami FL 33139" className={INPUT} />
              </div>
            </div>
          </Card>

          {/* Buyer */}
          <Card title="Buyer Information">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name <Required /></Label>
                <input name="buyer_first_name" type="text" required className={INPUT} />
              </div>
              <div>
                <Label>Last Name <Required /></Label>
                <input name="buyer_last_name" type="text" required className={INPUT} />
              </div>
              <div>
                <Label>Phone</Label>
                <input name="buyer_phone" type="tel" placeholder="(305) 555-0100" className={INPUT} />
              </div>
              <div>
                <Label>Email</Label>
                <input name="buyer_email" type="email" className={INPUT} />
              </div>
              <div className="col-span-2">
                <Label>Co-Buyer Name (if applicable)</Label>
                <input name="co_buyer_name" type="text" placeholder="Full name" className={INPUT} />
              </div>
            </div>
          </Card>

          {/* Seller */}
          <Card title="Seller Information (Optional)">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Seller Name</Label>
                <input name="seller_name" type="text" className={INPUT} />
              </div>
              <div>
                <Label>Seller Email</Label>
                <input name="seller_email" type="email" className={INPUT} />
              </div>
            </div>
          </Card>

          {/* Real Estate Agent */}
          <Card title="Real Estate Agent (Optional)">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Agent Name</Label>
                <input name="agent_name" type="text" className={INPUT} />
              </div>
              <div>
                <Label>Agent Phone</Label>
                <input name="agent_phone" type="tel" className={INPUT} />
              </div>
              <div className="col-span-2">
                <Label>Agent Email</Label>
                <input name="agent_email" type="email" className={INPUT} />
              </div>
            </div>
          </Card>

          {/* File Attachments */}
          <Card title="Attachments">
            <p className="text-xs text-gray-400 mb-3">Purchase contract, ID, proof of funds, etc.</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl py-6 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
            >
              Click to attach files (PDF, JPG, PNG, DOCX)
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.docx,.doc"
              onChange={handleFiles}
              className="hidden"
            />
            {files.length > 0 && (
              <ul className="mt-3 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-xs bg-gray-50 px-3 py-2 rounded-lg">
                    <span className="truncate text-gray-700 max-w-xs">{f.name}</span>
                    <span className="text-gray-400 ml-2 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="ml-3 text-red-400 hover:text-red-600 shrink-0"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Notes */}
          <Card title="Notes">
            <textarea
              name="notes"
              rows={3}
              placeholder="Any additional information for the team…"
              className={`${INPUT} resize-none`}
            />
          </Card>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-medium py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit Buyer Notification'}
          </button>
        </form>
      </main>
    </div>
  )
}

const INPUT = 'w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-700 mb-1">{children}</label>
}

function Required() {
  return <span className="text-red-500 ml-0.5">*</span>
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}
