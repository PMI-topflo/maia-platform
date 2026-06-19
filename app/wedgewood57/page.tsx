import AssociationPortal from '@/components/AssociationPortal'

export default async function PageWedgewood57({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="WBP" lang={lang} />
}
