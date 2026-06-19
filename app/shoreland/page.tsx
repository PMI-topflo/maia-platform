import AssociationPortal from '@/components/AssociationPortal'

export default async function PageShoreland({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="SHORE" lang={lang} />
}
