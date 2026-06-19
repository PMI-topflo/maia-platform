import AssociationPortal from '@/components/AssociationPortal'

export default async function PageKimgarden({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="KGA" lang={lang} />
}
