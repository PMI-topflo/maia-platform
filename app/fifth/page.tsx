import AssociationPortal from '@/components/AssociationPortal'

export default async function PageFifth({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="FIFTH" lang={lang} />
}
