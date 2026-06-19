import AssociationPortal from '@/components/AssociationPortal'

export default async function PageVenetianrec({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="VPREC" lang={lang} />
}
