import AssociationPortal from '@/components/AssociationPortal'

export default async function PageIslandhouse({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="ISLAND" lang={lang} />
}
