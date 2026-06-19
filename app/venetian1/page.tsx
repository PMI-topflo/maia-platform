import AssociationPortal from '@/components/AssociationPortal'

export default async function PageVenetian1({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="VPCI" lang={lang} />
}
