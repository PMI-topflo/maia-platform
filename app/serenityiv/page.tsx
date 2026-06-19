import AssociationPortal from '@/components/AssociationPortal'

export default async function PageSerenityiv({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="SP" lang={lang} />
}
