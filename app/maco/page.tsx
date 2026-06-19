import AssociationPortal from '@/components/AssociationPortal'

export default async function PageMaco({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="MACO" lang={lang} />
}
