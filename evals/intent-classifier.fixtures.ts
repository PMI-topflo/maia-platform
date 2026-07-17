// =====================================================================
// evals/intent-classifier.fixtures.ts
//
// Labeled resident messages for the intent-router eval
// (evals/run-intent-eval.ts). Each case encodes a commitment the
// classifier's system prompt actually makes — especially the tricky
// boundaries that the LLM router was introduced to get right and that a
// naive keyword matcher gets wrong:
//   • "how much do I owe" / "meu saldo" → ledger, NOT payment
//   • the word "meeting"/"visit" alone → NOT schedule
//   • the word "help"/"urgent" alone → NOT emergency
//   • greetings / thanks / language requests → general
//
// `acceptable` lists additional intents that are also a pass for a
// genuinely ambiguous message (the prompt allows a low-confidence
// best-guess there). Keep this list honest — only add an alternate when
// the prompt truly leaves it open, otherwise the eval stops catching
// regressions.
// =====================================================================

import type { MaiaIntent } from '../lib/intent-classifier'

export interface IntentFixture {
  message:     string
  expected:    MaiaIntent
  acceptable?: MaiaIntent[]
  note?:       string
}

export const INTENT_FIXTURES: IntentFixture[] = [
  // ── maintenance ──────────────────────────────────────────────────
  { message: 'My AC stopped working and the unit is 85 degrees', expected: 'maintenance' },
  { message: "There's a leak under my kitchen sink", expected: 'maintenance' },
  { message: 'I have roaches coming from the hallway', expected: 'maintenance' },

  // ── payment (HOW to pay) — must NOT be confused with ledger ───────
  { message: 'How do I set up autopay for my HOA dues?', expected: 'payment' },
  { message: 'Where do I send my monthly payment?', expected: 'payment' },
  { message: 'Can I pay my assessment with a credit card?', expected: 'payment' },

  // ── ledger (their own financials) — the big confusable ───────────
  { message: "What's my balance?", expected: 'ledger' },
  { message: 'How much do I owe?', expected: 'ledger' },
  { message: 'Can you send me my account statement?', expected: 'ledger' },
  { message: 'Am I paid up / is my account current?', expected: 'ledger' },
  { message: 'Did you receive my payment last week?', expected: 'ledger' },
  { message: 'meu saldo por favor', expected: 'ledger', note: 'PT — balance' },
  { message: 'cuánto debo en mi cuenta', expected: 'ledger', note: 'ES — how much do I owe' },
  { message: 'combien je dois', expected: 'ledger', note: 'FR — how much do I owe' },

  // ── parking ──────────────────────────────────────────────────────
  { message: 'I need a new parking sticker for my car', expected: 'parking' },
  { message: 'How do I register my vehicle for the lot?', expected: 'parking', acceptable: ['documents'] },

  // ── schedule (must be EXPLICIT) ──────────────────────────────────
  { message: "I'd like to book a unit inspection for next Tuesday at 2pm", expected: 'schedule' },
  { message: 'Can we set up a meeting with management on Friday morning?', expected: 'schedule' },

  // ── emergency (real, active) ─────────────────────────────────────
  { message: 'Water is flooding my entire unit right now!', expected: 'emergency' },
  { message: 'I smell gas in the building', expected: 'emergency' },

  // ── board_info ───────────────────────────────────────────────────
  { message: 'Who are the current board members?', expected: 'board_info' },
  { message: 'How can I contact the board president?', expected: 'board_info' },

  // ── documents ────────────────────────────────────────────────────
  { message: 'Can you send me a copy of the association rules and regulations?', expected: 'documents' },
  { message: 'I need an estoppel certificate for my closing', expected: 'documents' },

  // ── arc_request ──────────────────────────────────────────────────
  { message: 'I want to paint my front door a different color — do I need approval?', expected: 'arc_request' },
  { message: 'Looking to install a fence in my backyard, whats the approval process', expected: 'arc_request' },

  // ── vendor_ach ───────────────────────────────────────────────────
  { message: "I'm a vendor and need to submit my banking info for ACH payments", expected: 'vendor_ach' },

  // ── invoice_approval ─────────────────────────────────────────────
  { message: "I'm on the board — how do I approve the invoice you sent?", expected: 'invoice_approval' },

  // ── general (greetings / social / vague) ─────────────────────────
  { message: 'Hi Maia!', expected: 'general' },
  { message: 'Thank you so much, have a great day', expected: 'general' },
  { message: 'Can you speak Spanish?', expected: 'general' },

  // ── tricky negatives: keyword traps the LLM router must resist ───
  { message: 'I had a question about the last board meeting minutes', expected: 'documents', acceptable: ['general', 'board_info'], note: '"meeting" present but NOT a scheduling request' },
  { message: 'urgent, please help', expected: 'general', acceptable: ['maintenance'], note: '"urgent"/"help" alone is NOT emergency' },
]
