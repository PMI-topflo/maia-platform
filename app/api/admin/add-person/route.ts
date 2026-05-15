import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { type, data } = await req.json()

  if (!type || !data) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }

  if (type === 'owner') {
    const { first_name, last_name, emails, phone, association_code, unit_number, address, city, state, zip_code, language } = data
    if (!first_name || !last_name || !association_code) {
      return NextResponse.json({ ok: false, error: 'First name, last name, and association are required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('owners').insert({
      first_name, last_name, emails: emails || null, phone: phone || null,
      association_code, unit_number: unit_number || null, address: address || null,
      city: city || null, state: state || null, zip_code: zip_code || null,
      language: language || 'en', verified_status: 'verified',
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (type === 'board') {
    const { first_name, last_name, email, phone, association_code, position } = data
    if (!first_name || !last_name || !association_code) {
      return NextResponse.json({ ok: false, error: 'First name, last name, and association are required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('board_members').insert({
      first_name, last_name, email: email || null, phone: phone || null,
      association_code, position: position || null, active: true,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (type === 'agent') {
    const { full_name, email, phone, license_number, license_expiry, brokerage } = data
    if (!full_name) {
      return NextResponse.json({ ok: false, error: 'Full name is required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('real_estate_agents').insert({
      full_name, email: email || null, phone: phone || null,
      license_number: license_number || null, license_expiry: license_expiry || null,
      brokerage: brokerage || null, status: 'active',
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (type === 'vendor') {
    const { company_name, contact_name, email, phone, service_type, license_number } = data
    if (!company_name) {
      return NextResponse.json({ ok: false, error: 'Company name is required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('vendors').insert({
      company_name, contact_name: contact_name || null, email: email || null,
      phone: phone || null, service_type: service_type || null,
      license_number: license_number || null, status: 'active',
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (type === 'staff') {
    const { name, email, personal_email, phone, role, department } = data
    if (!name || !email) {
      return NextResponse.json({ ok: false, error: 'Name and email are required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('pmi_staff').insert({
      name,
      email,
      personal_email: personal_email || null,
      phone:          phone          || null,
      role:           role           || null,
      department:     department     || null,
      active: true,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (type === 'unit_manager') {
    const { first_name, last_name, email, phone, association_code, managed_units, company_name, notes } = data
    if (!first_name || !last_name || !association_code) {
      return NextResponse.json({ ok: false, error: 'First name, last name, and association are required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('unit_managers').insert({
      first_name, last_name, email: email || null, phone: phone || null,
      association_code, managed_units: managed_units ?? [],
      company_name: company_name || null, notes: notes || null, active: true,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (type === 'building_manager') {
    const { first_name, last_name, email, phone, association_code, company_name, notes } = data
    if (!first_name || !last_name || !association_code) {
      return NextResponse.json({ ok: false, error: 'First name, last name, and association are required' }, { status: 400 })
    }
    const { error } = await supabaseAdmin.from('building_managers').insert({
      first_name, last_name, email: email || null, phone: phone || null,
      association_code, company_name: company_name || null, notes: notes || null, active: true,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: false, error: 'Unknown type' }, { status: 400 })
}
