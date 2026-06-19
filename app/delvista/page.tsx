import AssociationPortal from '@/components/AssociationPortal'

export default async function PageDelvista({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="DELA" lang={lang} />
}
