import AssociationPortal from '@/components/AssociationPortal'

export default async function PageGoldkey({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="GK7" lang={lang} />
}
