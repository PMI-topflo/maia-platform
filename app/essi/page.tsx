import AssociationPortal from '@/components/AssociationPortal'

export default async function PageEssi({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="ESSI" lang={lang} />
}
