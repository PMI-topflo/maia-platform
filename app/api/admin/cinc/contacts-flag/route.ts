// =====================================================================
// app/api/admin/cinc/contacts-flag/route.ts
//
// GET — returns { isContactsFlagOn: boolean | null }
//
// Backs a banner on the CINC sync page (and a polling tile on the admin
// tools page) so staff get advance notice the moment CINC enables the
// "Contacts and Consent" feature for our tenant. When that flag flips,
// listAssociationProperties() must be migrated to the v2 endpoint plus
// a second call to /homeowners/propertyContacts — see CINC_API.md.
// =====================================================================

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { getContactsAndConsentFlag } from '@/lib/integrations/cinc'

export const dynamic = 'force-dynamic'

export async function GET() {
  const token   = (await cookies()).get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null
  if (!session || session.persona !== 'staff') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const flag = await getContactsAndConsentFlag({ forceRefresh: true })
    return NextResponse.json({ isContactsFlagOn: flag })
  } catch (err) {
    return NextResponse.json(
      { error: `CINC contactsFlag fetch failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
