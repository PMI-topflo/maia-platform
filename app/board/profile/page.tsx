import PersonaProfileShell from '@/lib/profile-page-shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My Profile — Board Member' }

export default function BoardProfilePage() {
  return <PersonaProfileShell persona="board" redirectIfNot="/board" title="BOARD · MY PROFILE" />
}
