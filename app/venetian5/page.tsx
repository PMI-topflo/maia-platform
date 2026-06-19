import AssociationPortal from '@/components/AssociationPortal'

export default async function PageVenetian5({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="VPC5" lang={lang} />
}
