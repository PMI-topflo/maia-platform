import PersonaProfileShell from '@/lib/profile-page-shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Profile — Tenant' }

export default function TenantProfilePage() {
  return <PersonaProfileShell persona="tenant" redirectIfNot="/tenant" title="TENANT · MY PROFILE" />
}
