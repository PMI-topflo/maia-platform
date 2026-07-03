'use client'

import { useState } from 'react'

// Static reference diagram of the live Twilio voice IVR flow in
// app/api/webhook/route.ts (handleVoice / handleVoiceInput / handleVoiceLangSelect /
// handleVoiceCategorySelect / unknownCallerHandoff). This is a snapshot for staff
// orientation, not generated from the code — if the flow changes, update this
// diagram alongside it.
//
// Post-2026-07-02 redesign: known callers now go straight from the greeting
// to the fixed 1-5 category menu (free-speech intent guessing was dropped —
// it wasn't reliable enough on voice, even on Sonnet 5). Category picks 3
// (new tenant/buyer application) and 4 (association documents) are fixed,
// non-LLM scripts that text the caller a real link; only 1 (maintenance)
// and 5 (leave a message) still run through the Sonnet answer engine. A
// quick emergency check is the only thing that can still bypass the menu.

const COLOR = {
  navy:   '#0d0d0d',
  gold:   '#f26a1b',
  green:  '#1a6b3c',
  muted:  '#6b7280',
  border: '#e5e7eb',
  card:   '#ffffff',
  bg:     '#fafaf9',
}

// What MAIA actually says at each step (English source strings, copied
// verbatim from app/api/webhook/route.ts — localized versions exist for
// the other 6 supported languages). Nodes with no fixed script (LLM-
// generated, or pure routing decisions) say so instead of faking a quote.
interface NodeDoc { title: string; lines?: string[]; note?: string; source: string }
const DOC: Record<string, NodeDoc> = {
  start: {
    title: 'Incoming Call',
    note: 'No spoken line here — Twilio POSTs to /api/webhook and handleVoice() takes over.',
    source: 'handleVoice()',
  },
  langDecision: {
    title: 'No saved language for this number?',
    note: 'Routing decision only, nothing is spoken here — checks session_language on the conversation_state row.',
    source: 'handleVoice()',
  },
  languageMenu: {
    title: 'Language Menu',
    lines: [
      '"For English, press or say 1."',
      '"Para español, oprima o diga 2."',
      '"Para português, aperte ou diga 3."',
      '"For more languages, press 9."',
      '— pressing 9 —',
      '"Pour le français, appuyez sur 4."',
      '"For Hebrew, press 5."',
      '"Для русского, нажмите 6."',
      '"Pou Kreyòl, peze 7."',
    ],
    source: 'languageMenuTwiml()',
  },
  personaDecision: {
    title: 'Registered contact (known persona)?',
    note: 'Routing decision only — ctx.persona from buildCallerContext() (owner/tenant/board/vendor/agent vs. unknown).',
    source: 'handleVoice()',
  },
  nonIdentified: {
    title: 'Non-Identified Path',
    lines: [
      '"Hello! This is Maia, your 24 hours a day, 7 days a week PMI Top Florida Properties AI assistant. I\'m here to help with anything you need and make sure your message reaches our team so they can handle your request the next business day."',
      '"I see that your call is coming from a non-registered phone number, so I\'ve just texted you a link to pre-register. Once you fill it out, a member of our team will reach out to help and add you to our system."',
    ],
    note: 'Two separate <Say> blocks (kept apart so the length cap on TTS cleanup can\'t truncate them together). Also fires an SMS with the pre-register link.',
    source: 'unknownCallerHandoff() — UNKNOWN_CALLER_INTRO() + the explain string',
  },
  greeting: {
    title: 'Personalized Greeting',
    lines: ['"Hello {FirstName}! Thank you for calling PMI Top Florida Properties."'],
    note: '{FirstName} is filled in live from the matched contact — ctx.name.split(\' \')[0]. Spoken in the SAME turn as the category menu below (one Gather, not two) — there\'s no separate open "how can I help" prompt anymore. Unknown callers never reach this node.',
    source: 'getVoiceGreeting()',
  },
  callerSpeaks: {
    title: 'Caller Speaks / Presses',
    note: 'No spoken line — this is the re-entry point handleVoiceInput() hits on every subsequent turn (after a category is answered, or after the non-identified intro).',
    source: 'handleVoiceInput()',
  },
  needDecision: {
    title: 'What does the caller need?',
    note: 'Routing decision only. Order checked: isConversationEnd() → WhatsApp-send intent → a quick classifyIntent() (Haiku) pass whose ONLY job now is catching a true emergency. Everything else — free-speech intent guessing was dropped as unreliable — falls through to the category menu.',
    source: 'handleVoiceInput()',
  },
  goodbye: {
    title: 'Goodbye',
    lines: ['"You\'re very welcome! It was my pleasure to help. Take care and have a wonderful day! 🌸"'],
    note: 'Fixed script, localized per language — not LLM-generated. Ends the call (<Hangup/>).',
    source: 'voiceGoodbye()',
  },
  emergency: {
    title: 'Emergency Fast-Path',
    note: 'The one thing that can still skip the menu. A true emergency (flooding, no AC, safety hazard) goes straight to the Sonnet answer engine instead of waiting behind the numbered menu.',
    source: 'handleVoiceInput() — classifyIntent() intent === \'emergency\'',
  },
  whatsapp: {
    title: 'Cross-Channel WhatsApp',
    lines: [
      'Known caller: "Done! I\'ve sent that information to your WhatsApp. Is there anything else I can help you with?"',
      'Unknown caller: "Sure! What is your WhatsApp number? You can say each digit, or enter them on your keypad and press pound when done."',
      'On send failure: "I\'m sorry, I wasn\'t able to send that to your WhatsApp. Please call our office at (305) 900-5077…"',
    ],
    note: 'The actual info sent to WhatsApp is generated live by the MAIA Answer Engine (or the ledger flow, for ledger requests) — only the spoken confirmation above is fixed. The success/failure line now depends on whether the Twilio send actually worked, not assumed.',
    source: 'handleVoiceToWhatsApp() / sendWhatsAppFromVoice()',
  },
  categoryMenu: {
    title: 'Category Menu',
    lines: [
      '"Please say what you need, or press: 1 for maintenance or a repair. 2 for payments or your account balance. 3 for a new tenant or buyer application. 4 for association documents. Or 5 to leave a message for our team."',
    ],
    note: 'Only digits 1-5 (or their spoken names) are handled — the old "describe it instead of pressing" free-text fallback was dropped. Anything unrecognized just repeats this menu.',
    source: 'categoryMenuTwiml() — CATEGORY_PROMPT.en',
  },
  answerEngine: {
    title: 'MAIA Answer Engine',
    note: 'Not a fixed sentence — every reply here is generated live by Claude Sonnet 5, guided by a system prompt built from caller context (name/persona/unit/association), the taught knowledge base, and buildSkillsPromptBlock(\'customer\') (Association Attorney, Customer Negotiator, Trade Troubleshoot, PMI Triage Policy, etc.). Reached by menu digit 1 (maintenance), digit 5 (leave a message), or the emergency fast-path.',
    source: 'getMaiaIntelligentResponse()',
  },
  ledger: {
    title: 'Ledger Flow',
    lines: [
      'By SMS: "Hi! Reply to this text with \\"ledger\\" and I\'ll securely send your account statement. 🌸" → confirms: "I\'ll text you to send your account statement securely — please check your messages."',
      'By WhatsApp: "Hi! Reply to this WhatsApp message with \\"ledger\\" and I\'ll securely send your account statement. 🌸" → confirms: "I\'ve sent you a WhatsApp message — reply \\"ledger\\" there and I\'ll send your account statement securely."',
    ],
    note: 'Voice can\'t run OTP/numbered menus well, so it nudges the caller to continue on text/WhatsApp instead of reading the ledger aloud. Menu digit 2.',
    source: 'startLedgerFlow(ctx, deliverVia)',
  },
  newApplication: {
    title: 'New Application (fixed)',
    lines: ['"For a new tenant or buyer application, I\'ve just texted you the link to apply online. If you have any questions, our leasing team is happy to help at service@topfloridaproperties.com."'],
    note: 'Fixed script — NOT generated by Sonnet. Texts the real application link (pmitopfloridaproperties.rentvine.com/public/apply) instead of reading a URL aloud or risking a generated answer. Menu digit 3.',
    source: 'newApplicationResponse()',
  },
  associationDocs: {
    title: 'Association Documents (fixed)',
    lines: ['"For association documents like governing documents, financials, or meeting minutes, I\'ve texted you a link to your resident portal. If you don\'t see what you need there, email support@topfloridaproperties.com and our team will send it to you."'],
    note: 'Fixed script — NOT generated by Sonnet. Texts the resident portal link (pmitfp.cincwebaxis.com). Menu digit 4.',
    source: 'associationDocumentResponse()',
  },
}

function Box({
  x, y, w, h, title, lines, fill = COLOR.card, stroke = COLOR.navy, titleColor = COLOR.navy, nodeKey, onSelect,
}: {
  x: number; y: number; w: number; h: number
  title: string; lines?: string[]
  fill?: string; stroke?: string; titleColor?: string
  nodeKey: string; onSelect: (key: string) => void
}) {
  return (
    <g onClick={() => onSelect(nodeKey)} style={{ cursor: 'pointer' }}>
      <title>{DOC[nodeKey]?.note ?? 'Click for the real sentence(s) MAIA says here.'}</title>
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

function Diamond({ x, y, w, h, label, nodeKey, onSelect }: { x: number; y: number; w: number; h: number; label: string[]; nodeKey: string; onSelect: (key: string) => void }) {
  const cx = x + w / 2
  const cy = y + h / 2
  const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`
  return (
    <g onClick={() => onSelect(nodeKey)} style={{ cursor: 'pointer' }}>
      <title>{DOC[nodeKey]?.note ?? 'Click for detail.'}</title>
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

function NodeModal({ nodeKey, onClose }: { nodeKey: string; onClose: () => void }) {
  const doc = DOC[nodeKey]
  if (!doc) return null
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(13,13,13,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: COLOR.card, borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
      >
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: `1px solid ${COLOR.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{doc.title}</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: COLOR.muted, fontFamily: 'monospace' }}>{doc.source}</p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer', color: COLOR.muted, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          {doc.lines?.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {doc.lines.map((line, i) => (
                <li key={i} style={{ fontSize: '0.9rem', lineHeight: 1.5, color: COLOR.navy, background: COLOR.bg, borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: '0.9rem', color: COLOR.muted, fontStyle: 'italic' }}>No fixed spoken line at this step.</p>
          )}
          {doc.note && (
            <p style={{ marginTop: doc.lines?.length ? '0.9rem' : 0, fontSize: '0.8rem', color: COLOR.muted, lineHeight: 1.5 }}>{doc.note}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VoiceFlowDiagram() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div style={{ overflowX: 'auto', background: COLOR.bg, borderRadius: 8, padding: '1rem' }}>
      <svg viewBox="-40 0 1150 1780" width="100%" style={{ minWidth: 940, display: 'block' }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={COLOR.muted} />
          </marker>
        </defs>

        {/* Row 1 — entry */}
        <Box x={420} y={16} w={200} h={48} title="Incoming Call" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          nodeKey="start" onSelect={setSelected} />
        <Arrow path="M520,64 L520,96" />

        {/* Row 2 — first-time caller? */}
        <Diamond x={400} y={96} w={240} h={90} label={['No saved language', 'for this number?']}
          nodeKey="langDecision" onSelect={setSelected} />
        <Arrow path="M400,141 L120,141 L120,220" label="Yes — first call" labelX={155} labelY={130} />
        <Arrow path="M520,186 L520,410" label="No — has a saved language" labelX={528} labelY={300} />

        {/* Row 3a — language menu */}
        <Box x={20} y={220} w={220} h={120} title="Language Menu" fill="#fff7ed" stroke={COLOR.gold}
          lines={['1 EN · 2 ES · 3 PT', '9 = more languages', '(4 FR · 5 HE · 6 RU · 7 HT)', 'DTMF or spoken']}
          nodeKey="languageMenu" onSelect={setSelected} />
        <Arrow path="M240,280 L400,280 L400,410 L500,410" dashed label="picks a language" labelX={280} labelY={272} />

        {/* Row 3 — persona known? */}
        <Diamond x={400} y={410} w={240} h={90} label={['Registered contact', '(known persona)?']}
          nodeKey="personaDecision" onSelect={setSelected} />
        <Arrow path="M400,455 L120,455 L120,560" label="No — unknown" labelX={150} labelY={445} />
        <Arrow path="M640,455 L820,455 L820,560" label="Yes — known" labelX={700} labelY={445} />

        {/* Row 4a — unknown path */}
        <Box x={20} y={560} w={220} h={140} title="Non-Identified Path" fill={COLOR.card} stroke={COLOR.gold}
          lines={['Intro + explains, texts a', 'pre-register link (SMS)', 'then an open-ended', 'Gather for anything else']}
          nodeKey="nonIdentified" onSelect={setSelected} />
        <Arrow path="M60,700 L-10,730 L-10,1440 L390,1440" dashed label="their next turn" labelX={-30} labelY={1100} />

        {/* Row 4b — greeting, feeds straight into the category menu (same turn) */}
        <Box x={710} y={560} w={220} h={110} title="Personalized Greeting" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Name-aware, knows role', '(owner/tenant/board/vendor)']}
          nodeKey="greeting" onSelect={setSelected} />
        <Arrow path="M780,670 C 700,740 640,760 620,780" label="same turn, one prompt" labelX={640} labelY={720} />

        {/* Row 5 — category menu (the main hub now) */}
        <Box x={480} y={780} w={280} h={130} title="Category Menu" fill="#fff7ed" stroke={COLOR.gold}
          lines={['1 Maintenance · 2 Payments', '3 New tenant/buyer app', '4 Association documents', '5 Leave a message']}
          nodeKey="categoryMenu" onSelect={setSelected} />

        {/* Row 6 — 4 outcomes of the category menu */}
        <Arrow path="M560,910 L200,970" label="digit 1 / 5" labelX={330} labelY={935} />
        <Arrow path="M640,910 L480,970" label="digit 2" labelX={555} labelY={945} />
        <Arrow path="M700,910 L750,970" label="digit 3" labelX={730} labelY={945} />
        <Arrow path="M740,910 L1040,970" label="digit 4" labelX={900} labelY={950} />

        <Box x={40} y={970} w={280} h={110} title="MAIA Answer Engine" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          lines={['Claude Sonnet 5 + Skills', '(maintenance / leave a', 'message / emergency)']}
          nodeKey="answerEngine" onSelect={setSelected} />

        <Box x={370} y={970} w={220} h={110} title="Ledger Flow" fill={COLOR.card} stroke={COLOR.navy}
          lines={['OTP + CINC lookup', '→ SMS or WhatsApp']}
          nodeKey="ledger" onSelect={setSelected} />

        <Box x={640} y={970} w={220} h={110} title="New Application" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Fixed script —', 'texts the real', 'application link']}
          nodeKey="newApplication" onSelect={setSelected} />

        <Box x={900} y={970} w={200} h={110} title="Association Docs" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Fixed script —', 'texts the resident', 'portal link']}
          nodeKey="associationDocs" onSelect={setSelected} />

        {/* Row 7 — every outcome's follow-up Gather funnels to the same re-entry point */}
        <Arrow path="M180,1080 L420,1440" />
        <Arrow path="M480,1080 L460,1440" />
        <Arrow path="M750,1080 L500,1440" />
        <Arrow path="M1000,1080 L540,1440" />

        <Box x={390} y={1440} w={200} h={54} title="Caller Speaks / Presses" fill={COLOR.navy} stroke={COLOR.navy} titleColor="#fff"
          nodeKey="callerSpeaks" onSelect={setSelected} />
        <Arrow path="M490,1494 L490,1526" />

        {/* Row 8 — what did they say NOW? (only reached between menu turns) */}
        <Diamond x={360} y={1526} w={260} h={100} label={['What does the', 'caller need?']}
          nodeKey="needDecision" onSelect={setSelected} />

        <Arrow path="M360,1576 L60,1576 L60,1650" label="says goodbye/thanks" labelX={70} labelY={1566} />
        <Arrow path="M400,1610 L260,1610 L260,1650" label="“send to WhatsApp”" labelX={280} labelY={1602} />
        <Arrow path="M620,1556 L680,1556" label="true emergency" labelX={628} labelY={1546} />
        <Arrow path="M580,1610 L740,1610 L740,900 L760,900" dashed label="default — back to the menu" labelX={610} labelY={1602} />

        <Box x={680} y={1526} w={220} h={100} title="Emergency Fast-Path" fill={COLOR.card} stroke={COLOR.gold}
          lines={['Flooding, no AC,', 'safety hazard — skips', 'straight to the answer', 'engine, no menu wait']}
          nodeKey="emergency" onSelect={setSelected} />

        <Box x={-30} y={1650} w={180} h={100} fill="#f0fdf4" stroke={COLOR.green} title="Goodbye" titleColor={COLOR.green}
          lines={['Warm localized sign-off', '+ Hangup (terminal —', 'checked before the DB', 'lookup chain, for speed)']}
          nodeKey="goodbye" onSelect={setSelected} />

        <Box x={170} y={1650} w={220} h={110} title="Cross-Channel WhatsApp" fill={COLOR.card} stroke={COLOR.navy}
          lines={['Ledger terms → ledger prompt', 'sent via WhatsApp directly', 'Else → MAIA answer', 'generated + sent via WhatsApp']}
          nodeKey="whatsapp" onSelect={setSelected} />

        {/* Legend */}
        <g transform="translate(20, 1770)">
          <rect x={0} y={-14} width={14} height={14} rx={3} fill={COLOR.navy} />
          <text x={20} y={-3} fontSize={11} fill={COLOR.muted}>Processing / engine</text>
          <rect x={190} y={-14} width={14} height={14} rx={3} fill="#fff7ed" stroke={COLOR.gold} />
          <text x={210} y={-3} fontSize={11} fill={COLOR.muted}>Menu / decision</text>
          <rect x={360} y={-14} width={14} height={14} rx={3} fill="#f0fdf4" stroke={COLOR.green} />
          <text x={380} y={-3} fontSize={11} fill={COLOR.muted}>Terminal (ends call)</text>
          <text x={560} y={-3} fontSize={11} fill={COLOR.muted}>Click any box for the exact words MAIA says there.</text>
        </g>
      </svg>

      {selected && <NodeModal nodeKey={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
