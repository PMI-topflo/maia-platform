import { redirect } from 'next/navigation'
import { resolveUnitsAuth } from '@/lib/units-portal-auth'
import UnitDetailClient from './UnitDetailClient'

export const dynamic = 'force-dynamic'

export default async function UnitPage(props: { searchParams: Promise<{ account?: string; assoc?: string }> }) {
  const { account, assoc } = await props.searchParams
  const auth = await resolveUnitsAuth(assoc ?? null)
  if (!auth) redirect('/')
  if (!account) redirect('/units')
  return <UnitDetailClient account={account} assoc={assoc ?? auth.assoc} />
}
