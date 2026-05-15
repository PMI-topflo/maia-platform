import PersonaProfileShell from '@/lib/profile-page-shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Profile — Building Manager' }

export default function BuildingManagerProfilePage() {
  return <PersonaProfileShell persona="building_manager" redirectIfNot="/building-manager" title="BUILDING MANAGER · MY PROFILE" />
}
