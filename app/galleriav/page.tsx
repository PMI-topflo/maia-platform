import AssociationPortal from '@/components/AssociationPortal'

export default async function PageGalleriav({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams
  return <AssociationPortal code="GVH" lang={lang} />
}
