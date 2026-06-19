import AssociationPortal from '@/components/AssociationPortal'

export default async function PageParcview({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="PVV" lang={lang} />
}
