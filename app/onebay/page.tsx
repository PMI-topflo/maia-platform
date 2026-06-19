import AssociationPortal from '@/components/AssociationPortal'

export default async function PageOnebay({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="ONE" lang={lang} />
}
