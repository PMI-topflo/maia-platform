import PersonaProfileShell from '@/lib/profile-page-shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Profile — Unit Manager' }

export default function UnitManagerProfilePage() {
  return <PersonaProfileShell persona="unit_manager" redirectIfNot="/unit-manager" title="UNIT MANAGER · MY PROFILE" />
}
