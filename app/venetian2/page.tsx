import AssociationPortal from '@/components/AssociationPortal'

export default async function PageVenetian2({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="VPCII" lang={lang} />
}
