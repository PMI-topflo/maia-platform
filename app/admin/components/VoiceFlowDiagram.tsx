'use client'

// Static reference diagram of the live Twilio voice IVR flow in
// app/api/webhook/route.ts (handleVoice / handleVoiceInput / handleVoiceLangSelect /
// handleVoiceCategorySelect / unknownCallerHandoff). This is a snapshot for staff
// orientation, not generated from the code — if the flow changes, update this
// diagram alongside it.

const COLOR = {
  navy:   '#0d0d0d',
  gold:   '#f26a1b',
  green:  '#1a6b3c',
  muted:  '#6b7280',
  border: '#e5e7eb',
  card:   '#ffffff',
  bg:     '#fafaf9',
}

function Box({
  x, y, w, h, title, lines, fill = COLOR.card, stroke = COLOR.navy, titleColor = COLOR.navy, tooltip,
}: {
  x: number; y: number; w: number; h: number
  title: string; lines?: string[]
  fill?: string; stroke?: string; titleColor?: string; tooltip?: string
}) {
  return (
    <g>
      <title>{tooltip ?? title}</title>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + (lines?.length ? 24 : h / 2 + 5)} textAnchor="middle" fontSize={13} fontWeight={700} fill={titleColor}>
        {title}
      </text>
      {lines?.map((line, i) => (
        <text key={i} x={x + w / 2} y={y + 44 + i * 16} textAnchor="middle" fontSize={11} fill={COLOR.muted}>
          {line}
        </text>
      ))}
    </g>
  )
}

function Diamond({ x, y, w, h, label, tooltip }: { x: number; y: number; w: number; h: number; label: string[]; tooltip?: string }) {
  const cx = x + w / 2
  const cy = y + h / 2
  const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`
  return (
    <g>
      <title>{tooltip ?? label.join(' ')}</title>
      <polygon points={points} fill="#fff7ed" stroke={COLOR.gold} strokeWidth={1.5} />
      {label.map((line, i) => (
        <text key={i} x={cx} y={cy - (label.length - 1) * 7 + i * 14 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={COLOR.navy}>
          {line}
        </text>
      ))}
    </g>
  )
}

function Arrow({ path, dashed = false, label, labelX, labelY }: { path: string; dashed?: boolean; label?: string; labelX?: number; labelY?: number }) {
  return (
    <g>
      <path d={path} fill="none" stroke={COLOR.muted} strokeWidth={1.5} strokeDasharray={dashed ? '5 4' : undefined} markerEnd="url(#arrowhead)" />
      {label && (
        <text x={labelX} y={labelY} fontSize={10.5} fontWeight={600} fill={COLOR.muted}>{label}</text>
      )}
    </g>
  )
}

export default function VoiceFlowDiagram() {
  return (
    <div style={{ overflowX: 'auto', background: COLOR.bg, borderRadius: 8, padding: '1rem' }}>
      <svg viewBox="-40 0 1150 1360" width="100%" style={{ minWidth: 940, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={COLOR.muted} />
          </marker>
        </defs>

        {/* Row 1 — entry */}
        <Box x={420} y={16} w={200} h={48} title="Incoming Call" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          tooltip="Twilio hits /api/webhook. handleVoice() runs." />
        <Arrow path="M520,64 L520,96" />

        {/* Row 2 — first-time caller? */}
        <Diamond x={400} y={96} w={240} h={90} label={['No saved language', 'for this number?']}
          tooltip="handleVoice(): checks session_language on the conversation_state row." />
        <Arrow path="M400,141 L120,141 L120,220" label="Yes — first call" labelX={155} labelY={130} />
        <Arrow path="M520,186 L520,410" label="No — has a saved language" labelX={528} labelY={300} />

        {/* Row 3a — language menu */}
        <Box x={20} y={220} w={220} h={120} title="Language Menu" fill="#fff7ed" stroke={COLOR.gold}
          lines={['1 EN · 2 ES · 3 PT', '9 = more languages', '(4 FR · 5 HE · 6 RU · 7 HT)', 'DTMF or spoken']}
          tooltip="languageMenuTwiml(). Digit or spoken language name via parseLanguageChoice()." />
        <Arrow path="M240,280 L400,280 L400,410 L500,410" dashed label="picks a language" labelX={280} labelY={272} />

        {/* Row 3 — persona known? */}
        <Diamond x={400} y={410} w={240} h={90} label={['Registered contact', '(known persona)?']}
          tooltip="ctx.persona from buildCallerContext() — owner/tenant/board/vendor/agent vs unknown." />
        <Arrow path="M400,455 L120,455 L120,560" label="No — unknown" labelX={150} labelY={445} />
        <Arrow path="M640,455 L820,455 L820,560" label="Yes — known" labelX={700} labelY={445} />

        {/* Row 4a — unknown path */}
        <Box x={20} y={560} w={220} h={140} title="Non-Identified Path" fill={COLOR.card} stroke={COLOR.gold}
          lines={['Intro + explains, texts a', 'pre-register link (SMS)', 'then an open-ended', 'Gather for anything else']}
          tooltip="unknownCallerHandoff(): signPreregisterToken() + SMS link, two <Say> blocks, then Gather." />

        {/* Row 4b — greeting */}
        <Box x={710} y={560} w={220} h={110} title="Personalized Greeting" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Name-aware, knows role', '(owner/tenant/board/vendor)', '+ "How can I help you?"']}
          tooltip="getVoiceGreeting(ctx) + getListenPrompt(lang) inside a single Gather." />

        <Arrow path="M130,700 L470,760" />
        <Arrow path="M820,670 L560,760" />

        {/* Row 5 — caller speaks (merge point) */}
        <Box x={420} y={760} w={200} h={54} title="Caller Speaks / Presses" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          tooltip="handleVoiceInput(): every subsequent turn re-enters here." />
        <Arrow path="M520,814 L520,846" />

        {/* Row 6 — what did they say? branch diamond */}
        <Diamond x={390} y={846} w={260} h={100} label={['What does the', 'caller need?']}
          tooltip="Order of checks: isConversationEnd → WhatsApp-send intent → classifyIntent (Haiku)." />

        <Arrow path="M390,896 L60,896 L60,970" label="says goodbye/thanks" labelX={70} labelY={886} />
        <Arrow path="M420,930 L280,930 L280,970" label="“send to WhatsApp”" labelX={300} labelY={922} />
        <Arrow path="M650,896 L980,896 L980,970" label="clear intent" labelX={905} labelY={886} />
        <Arrow path="M600,930 L740,930 L740,970" label="low-confidence / unclear" labelX={630} labelY={962} />

        {/* Row 7 — 4 outcome boxes */}
        <Box x={-30} y={970} w={180} h={100} fill="#f0fdf4" stroke={COLOR.green} title="Goodbye" titleColor={COLOR.green}
          lines={['Warm localized sign-off', '+ Hangup (terminal —', 'checked before the DB', 'lookup chain, for speed)']}
          tooltip="isConversationEnd() across all 7 languages → goodbyeTwiml(). Ends the call." />

        <Box x={180} y={970} w={220} h={110} title="Cross-Channel WhatsApp" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Ledger terms → ledger prompt', 'sent via WhatsApp directly', 'Else → MAIA answer', 'generated + sent via WhatsApp']}
          tooltip="handleVoiceToWhatsApp(): LEDGER_TERMS short-circuit vs. generic content path; unknown callers are asked for a number first." />

        <Box x={650} y={970} w={230} h={110} title="Category Menu / Confirm" fill="#fff7ed" stroke={COLOR.gold}
          lines={['Low-conf → "is that right?"', 'Unclear → 1 Maint · 2 Pay', '3 New tenant/buyer · 4 Docs', '5 Leave a message']}
          tooltip="Low confidence + confirmable intent → confirm_intent state. intent === 'general' → categoryMenuTwiml()." />

        <Box x={890} y={970} w={180} h={100} title="Direct Answer" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Skips the menu —', 'goes straight to the', 'answer engine below']}
          tooltip="classifyIntent() was confident → getMaiaIntelligentResponse() runs immediately, no menu." />

        {/* Row 8 — engines */}
        <Arrow path="M290,1080 L520,1150" />
        <Arrow path="M765,1080 L620,1150" />
        <Arrow path="M980,1070 L680,1150" />

        <Box x={420} y={1150} w={380} h={130} title="MAIA Answer Engine" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Claude Sonnet 5 + Skills injection', '(Association Attorney, Customer', 'Negotiator, Trade Troubleshoot,', 'PMI Triage Policy …) → spoken reply']}
          tooltip="getMaiaIntelligentResponse(): buildSkillsPromptBlock('customer') + Sonnet 5, max_tokens 1500. Runs on every clear/confirmed/category-resolved turn." />

        <Box x={840} y={1150} w={180} h={110} title="Ledger Flow" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Category-menu digit 2', 'OTP + CINC lookup', '→ SMS or WhatsApp']}
          tooltip="startLedgerFlow(ctx, deliverVia). Digit 2 on the category menu, or a WhatsApp ledger request." />
        <Arrow path="M765,1010 L930,1150" dashed label="digit 2" labelX={850} labelY={1080} />

        {/* Loop back — routed along the right edge to stay clear of the Goodbye/WhatsApp boxes */}
        <Arrow path="M800,1215 C 1095,1215 1095,700 650,896" dashed label="Gather again — loop" labelX={905} labelY={780} />

        {/* Legend */}
        <g transform="translate(20, 1300)">
          <rect x={0} y={0} width={14} height={14} rx={3} fill={COLOR.navy} />
          <text x={20} y={11} fontSize={11} fill={COLOR.muted}>Processing / engine</text>
          <rect x={190} y={0} width={14} height={14} rx={3} fill="#fff7ed" stroke={COLOR.gold} />
          <text x={210} y={11} fontSize={11} fill={COLOR.muted}>Menu / decision</text>
          <rect x={360} y={0} width={14} height={14} rx={3} fill="#f0fdf4" stroke={COLOR.green} />
          <text x={380} y={11} fontSize={11} fill={COLOR.muted}>Terminal (ends call)</text>
          <text x={560} y={11} fontSize={11} fill={COLOR.muted}>Hover any box for the function/detail it maps to.</text>
        </g>
      </svg>
    </div>
  )
}
