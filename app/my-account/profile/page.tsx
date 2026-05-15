import PersonaProfileShell from '@/lib/profile-page-shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Profile — Unit Owner' }

export default function OwnerProfilePage() {
  return <PersonaProfileShell persona="owner" redirectIfNot="/my-account" title="UNIT OWNER · MY PROFILE" />
}
