import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BUCKET = 'buyer-docs'

export async function GET() {
  // Used by the new-buyer form to fetch the associations list
  const { data, error } = await supabaseAdmin
    .from('associations')
    .select('association_code, association_name, association_type')
    .eq('active', true)
    .order('association_name')

  if (error) return NextResponse.json([], { status: 200 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const get = (key: string) => (formData.get(key) as string | null) ?? ''

    const association_code = get('association_code')
    const unit_number      = get('unit_number')
    const closing_date     = get('closing_date') || null
    const property_address = get('property_address')
    const buyer_first      = get('buyer_first_name')
    const buyer_last       = get('buyer_last_name')
    const buyer_phone      = get('buyer_phone')
    const buyer_email      = get('buyer_email')
    const co_buyer         = get('co_buyer_name')
    const seller_name      = get('seller_name')
    const seller_email     = get('seller_email')
    const agent_name       = get('agent_name')
    const agent_phone      = get('agent_phone')
    const agent_email      = get('agent_email')
    const notes            = get('notes')

    if (!association_code || !unit_number || !buyer_first || !buyer_last) {
      return NextResponse.json({ error: 'Association, unit number, and buyer name are required.' }, { status: 400 })
    }

    // Ensure bucket exists
    const { data: buckets } = await supabaseAdmin.storage.listBuckets()
    if (!buckets?.find(b => b.name === BUCKET)) {
      await supabaseAdmin.storage.createBucket(BUCKET, { public: false })
    }

    // Upload attachments
    const fileEntries = formData.getAll('files') as File[]
    const uploadedUrls: string[] = []

    for (const file of fileEntries) {
      if (!file || !file.name) continue
      const bytes = await file.arrayBuffer()
      const timestamp = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${association_code}/${timestamp}_${safeName}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: file.type, upsert: false })

      if (uploadError) {
        console.error('[BUYER UPLOAD]', uploadError)
        continue
      }

      const { data: signedData } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60 * 24 * 30) // 30 days

      if (signedData?.signedUrl) uploadedUrls.push(signedData.signedUrl)
    }

    // Look up association name
    const { data: assocData } = await supabaseAdmin
      .from('associations')
      .select('association_name')
      .eq('association_code', association_code)
      .single()

    const assocName = assocData?.association_name ?? association_code

    // Save to applications table
    const applicants = [
      { first_name: buyer_first, last_name: buyer_last, phone: buyer_phone, email: buyer_email },
      ...(co_buyer ? [{ first_name: co_buyer, last_name: '', role: 'co-buyer' }] : []),
    ]

    const appData = {
      association: association_code,
      app_type: 'buyer_notification',
      applicants,
      principals: seller_name ? [{ name: seller_name, email: seller_email, role: 'seller' }] : null,
      board_notes: [
        notes,
        agent_name ? `Agent: ${agent_name} ${agent_phone} ${agent_email}`.trim() : '',
        closing_date ? `Closing: ${closing_date}` : '',
        property_address ? `Address: ${property_address}` : '',
        uploadedUrls.length ? `Files:\n${uploadedUrls.join('\n')}` : '',
      ].filter(Boolean).join('\n\n') || null,
      docs_gov_id_url: uploadedUrls[0] ?? null,
    }

    await supabaseAdmin.from('applications').insert(appData)

    // Send email notification
    const staffEmail = process.env.STAFF_EMAIL ?? process.env.AR_EMAIL ?? 'ar@topfloridaproperties.com'
    const subject = `[New Buyer] ${buyer_first} ${buyer_last} — ${unit_number} @ ${assocName}`

    const htmlRows = [
      ['Association', `${association_code} — ${assocName}`],
      ['Unit', unit_number],
      ['Property Address', property_address || '—'],
      ['Closing Date', closing_date || '—'],
      ['Buyer', `${buyer_first} ${buyer_last}`],
      ['Buyer Phone', buyer_phone || '—'],
      ['Buyer Email', buyer_email || '—'],
      ['Co-Buyer', co_buyer || '—'],
      ['Seller', seller_name ? `${seller_name}${seller_email ? ` (${seller_email})` : ''}` : '—'],
      ['Agent', agent_name ? `${agent_name}${agent_phone ? ` · ${agent_phone}` : ''}${agent_email ? ` · ${agent_email}` : ''}` : '—'],
      ['Notes', notes || '—'],
    ]

    const tableRows = htmlRows.map(([k, v]) =>
      `<tr><td style="padding:6px 12px;font-weight:600;background:#f9fafb;white-space:nowrap;border-bottom:1px solid #e5e7eb">${k}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${v}</td></tr>`
    ).join('')

    const filesHtml = uploadedUrls.length
      ? `<h3 style="margin:16px 0 8px;font-size:14px">Attachments (${uploadedUrls.length})</h3><ul style="margin:0;padding-left:20px">${uploadedUrls.map((u, i) => `<li><a href="${u}">File ${i + 1}</a></li>`).join('')}</ul>`
      : ''

    const html = `
      <div style="font-family:sans-serif;font-size:14px;color:#111827;max-width:600px">
        <h2 style="margin:0 0 16px;font-size:18px">New Unit Buyer Notification</h2>
        <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          ${tableRows}
        </table>
        ${filesHtml}
        <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Submitted via MAIA Platform</p>
      </div>
    `

    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: staffEmail, subject, html }),
    }).catch(err => console.error('[BUYER EMAIL]', err))

    return NextResponse.json({ ok: true, filesUploaded: uploadedUrls.length })
  } catch (err) {
    console.error('[BUYER NOTIFICATION]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
