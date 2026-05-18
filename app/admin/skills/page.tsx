import SiteHeader from '@/components/SiteHeader'
import AdminNav from '../components/AdminNav'
import SkillsManager from './SkillsManager'
import { listSkills } from '@/lib/skills'

export const metadata = { title: 'Skills — PMI Top Florida' }
export const dynamic = 'force-dynamic'

export default async function SkillsPage() {
  const skills = await listSkills()
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader subtitle="STAFF DASHBOARD">
        {/* Skills lives under Tools now (removed from top nav). Keep
            Tools highlighted so staff know where to navigate back from. */}
        <AdminNav activeOverride="/admin/tools" />
      </SiteHeader>
      <main className="max-w-screen-xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">MAIA Skills</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload SKILL.md files. Enabled skills are injected into MAIA prompts based on audience.
          </p>
        </div>
        <SkillsManager initial={skills.map(s => ({
          id: s.id, slug: s.slug, name: s.name, description: s.description,
          audience: s.audience, enabled: s.enabled, uploaded_by: s.uploaded_by,
        }))} />
      </main>
    </div>
  )
}
