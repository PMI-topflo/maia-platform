import AssociationPortal from '@/components/AssociationPortal'

export default async function PageTropicana2({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="TROP" lang={lang} />
}
