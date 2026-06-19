import AssociationPortal from '@/components/AssociationPortal'

export default async function PageBrook({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="BHB" lang={lang} />
}
