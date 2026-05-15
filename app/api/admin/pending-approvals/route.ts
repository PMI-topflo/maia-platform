import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendEmail } from '@/lib/gmail'

export async function POST(req: NextRequest) {
  const { action, conversationId, data } = await req.json()

  if (!conversationId || !action) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  if (action === 'dismiss') {
    await supabaseAdmin
      .from('general_conversations')
      .update({ status: 'dismissed' })
      .eq('id', conversationId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'follow_up') {
    const { email, subject, body } = data ?? {}
    if (!email) return NextResponse.json({ ok: false, error: 'Missing email' }, { status: 400 })
    try {
      await sendEmail({ to: email, subject: subject ?? 'Following up from PMI Top Florida', html: `<p>${body ?? ''}</p>` })
      await supabaseAdmin
        .from('general_conversations')
        .update({ status: 'follow_up_sent' })
        .eq('id', conversationId)
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ ok: false, error: 'Failed to send email' }, { status: 500 })
    }
  }

  if (action === 'add_owner') {
    const { first_name, last_name, emails, phone, association_code, unit_number } = data ?? {}
    const { error } = await supabaseAdmin.from('owners').insert({
      first_name, last_name, emails, phone, association_code, unit_number,
      verified_status: 'verified',
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await supabaseAdmin.from('general_conversations').update({ status: 'resolved' }).eq('id', conversationId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_board') {
    const { full_name, email, phone, association_code, position } = data ?? {}
    const [first_name, ...rest] = (full_name ?? '').split(' ')
    const last_name = rest.join(' ')
    const { error } = await supabaseAdmin.from('board_members').insert({
      first_name, last_name, email, phone, association_code, position: position ?? null, active: true,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await supabaseAdmin.from('general_conversations').update({ status: 'resolved' }).eq('id', conversationId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_agent') {
    const { full_name, email, phone, license_number } = data ?? {}
    const { error } = await supabaseAdmin.from('real_estate_agents').insert({
      full_name, email, phone, license_number, status: 'active',
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await supabaseAdmin.from('general_conversations').update({ status: 'resolved' }).eq('id', conversationId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_vendor') {
    const { company_name, contact_name, email, phone, service_type } = data ?? {}
    const { error } = await supabaseAdmin.from('vendors').insert({
      company_name, contact_name, email, phone, service_type, status: 'active',
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await supabaseAdmin.from('general_conversations').update({ status: 'resolved' }).eq('id', conversationId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_staff') {
    const { name, email, personal_email, phone, role, department } = data ?? {}
    const { error } = await supabaseAdmin.from('pmi_staff').insert({
      name, email,
      personal_email: personal_email || null,
      phone, role, department, active: true,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await supabaseAdmin.from('general_conversations').update({ status: 'resolved' }).eq('id', conversationId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
