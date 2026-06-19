import AssociationPortal from '@/components/AssociationPortal'

export default async function PageManorsxi({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="MANXI" lang={lang} />
}
