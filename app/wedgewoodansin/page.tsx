import AssociationPortal from '@/components/AssociationPortal'

export default async function PageWedgewoodansin({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="WBPA" lang={lang} />
}
