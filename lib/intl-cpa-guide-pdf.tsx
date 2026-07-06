// =====================================================================
// lib/intl-cpa-guide-pdf.tsx
// Downloadable PDF an international applicant hands to their accountant,
// spelling out exactly what the CPA Financial Certification must contain.
// Content is shared with the in-app disclosure via
// lib/intl-applicant-docs-content.ts so the two never drift apart.
//
// Noto Sans (Latin/Cyrillic) + Noto Sans Hebrew are bundled locally
// (lib/fonts/) because react-pdf's built-in Helvetica only covers
// WinAnsi/Latin-1 -- Hebrew and Cyrillic would render as missing glyphs
// otherwise. Registered once at module load.
// =====================================================================

import path from 'node:path'
import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer'
import { INTL_DOCS_CONTENT, type IntlDocsLang } from './intl-applicant-docs-content'

const FONT_DIR = path.join(process.cwd(), 'lib', 'fonts')

Font.register({
  family: 'NotoSans',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSans-Regular.ttf'), fontWeight: 'normal' },
    { src: path.join(FONT_DIR, 'NotoSans-Bold.ttf'), fontWeight: 'bold' },
  ],
})
Font.register({
  family: 'NotoSansHebrew',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSansHebrew-Regular.ttf'), fontWeight: 'normal' },
    { src: path.join(FONT_DIR, 'NotoSansHebrew-Bold.ttf'), fontWeight: 'bold' },
  ],
})

const NAVY   = '#1f2a44'
const ORANGE = '#f26a1b'
const INK    = '#2b2f38'
const MUTED  = '#6b7280'

function stylesFor(rtl: boolean) {
  const fontFamily = rtl ? 'NotoSansHebrew' : 'NotoSans'
  const align = rtl ? 'right' : 'left'
  return StyleSheet.create({
    page: { padding: 40, fontSize: 10, fontFamily, color: INK },
    header: { borderBottomWidth: 2, borderBottomColor: ORANGE, paddingBottom: 10, marginBottom: 18 },
    brand: { fontSize: 10, color: MUTED, fontFamily, fontWeight: 'bold' as const },
    title: { fontSize: 16, color: NAVY, fontWeight: 'bold' as const, marginTop: 4, textAlign: align },
    intro: { fontSize: 10, lineHeight: 1.5, marginBottom: 10, textAlign: align },
    bulletRow: { flexDirection: rtl ? 'row-reverse' : 'row', marginTop: 6 },
    dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: ORANGE, marginTop: 5, marginHorizontal: 7 },
    bulletText: { fontSize: 10, lineHeight: 1.5, flex: 1, textAlign: align },
    footer: { position: 'absolute', bottom: 30, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8 },
    footerText: { fontSize: 8, color: MUTED, textAlign: align },
  })
}

export function IntlCpaGuidePdf({ lang }: { lang: IntlDocsLang }) {
  const c = INTL_DOCS_CONTENT[lang]
  const rtl = lang === 'he'
  const s = stylesFor(rtl)
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Text style={s.brand}>PMI TOP FLORIDA PROPERTIES</Text>
          <Text style={s.title}>{c.pdfTitle}</Text>
        </View>
        <Text style={s.intro}>{c.cpaIntro}</Text>
        {c.cpaBullets.map((b, i) => (
          <View key={i} style={s.bulletRow} wrap={false}>
            <View style={s.dot} />
            <Text style={s.bulletText}>{b}</Text>
          </View>
        ))}
        <View style={s.footer}>
          <Text style={s.footerText}>{c.pdfFooter}</Text>
        </View>
      </Page>
    </Document>
  )
}
