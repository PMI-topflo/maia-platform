import AssociationPortal from '@/components/AssociationPortal'

export default async function PageKane({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="KANE" lang={lang} />
}
