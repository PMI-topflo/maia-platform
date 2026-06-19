import AssociationPortal from '@/components/AssociationPortal'

export default async function PageLafarms({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="LFA" lang={lang} />
}
