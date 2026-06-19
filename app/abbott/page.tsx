import AssociationPortal from '@/components/AssociationPortal'

export default async function PageAbbott({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="ABBOTT" lang={lang} />
}
