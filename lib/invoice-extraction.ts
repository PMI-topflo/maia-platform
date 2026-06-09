// =====================================================================
// lib/invoice-extraction.ts
//
// Single-shot Claude extraction of structured fields from an invoice
// PDF. Returns a typed result + a confidence score so the intake-queue
// UI can flag low-confidence drafts for closer human review.
//
// Pattern mirrors lib/report-financials.ts:121 — Anthropic document
// content block with the PDF inlined as base64, single user-turn,
// strict JSON-only response.
//
// Model: Haiku. Invoices are short, structure is consistent (vendor
// name, invoice #, amount, dates), and we don't need reasoning. Cost
// matters because every inbound invoice email runs this once.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { assertClaudeBudget } from '@/lib/anthropic-guard'

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'

export interface ExtractedInvoice {
  vendorName:      string | null
  invoiceNumber:   string | null
  amount:          number | null
  invoiceDate:     string | null   // ISO YYYY-MM-DD
  dueDate:         string | null   // ISO YYYY-MM-DD
  associationHint: string | null   // any assoc-code-like token (3-6 caps) found
  accountNumber:   string | null   // utility/customer account number on the bill (FPL, water, cable…)
  confidence:      number          // 0..1 — how confident the model is that this is an invoice and the fields are correct
}

const EXTRACTION_PROMPT = `You are extracting structured data from an invoice PDF for an HOA / condo property management company.

Return a SINGLE JSON object and nothing else (no prose, no markdown fences). Schema:
{
  "vendor_name":      string or null   // the company that ISSUED the invoice (letterhead/"From" at the TOP, the party to be PAID), NOT the Bill-To customer
  "invoice_number":   string or null   // sometimes "Invoice #", "Inv No.", "1473", etc.
  "amount":           number or null   // the total amount due, in dollars (e.g. 2250.00). NOT a subtotal, NOT a previous balance — the new amount owed.
  "invoice_date":     string or null   // ISO YYYY-MM-DD — when the invoice was issued
  "due_date":         string or null   // ISO YYYY-MM-DD — when payment is due (often "Net 30" from invoice_date)
  "association_hint": string or null   // any 3-6 letter all-caps code on the document that looks like a property association code (e.g. "SP", "ESSI", "VENETIAN1"). Null if none.
  "account_number":   string or null   // the CUSTOMER / UTILITY ACCOUNT NUMBER identifying the service or property (utilities: FPL, water/sewer, Xfinity/cable, electric, gas). Labeled "Account Number", "Account #", "Acct No", "Customer Number". Return it EXACTLY as printed (keep any dashes/spaces). This is NOT the invoice number. Null if the bill has no account number.
  "confidence":       number           // 0..1. 1.0 = clearly an invoice with all fields. 0.0 = doesn't look like an invoice. 0.5 = some fields missing or ambiguous.
}

Rules:
- vendor_name is the ISSUER of the invoice — the company on the letterhead/logo at the TOP, the party to be PAID. The "Bill To" / "Ship To" party is the CUSTOMER and is NEVER the vendor.
- "PMI Top Florida Properties" / "Top Florida Properties" is USUALLY the Bill-To customer on a vendor's bill — in that case it is NOT the vendor, so return the actual issuer. BUT when PMI Top Florida Properties is the ISSUER (its name/logo is the letterhead at the top and an ASSOCIATION is the Bill To — e.g. management-fee or "RVP-####" invoices billed to a condo/HOA association), then "PMI Top Florida Properties" IS the vendor_name. Decide by WHO ISSUED it (top), not by the name.
- amount must be the FINAL amount owed for THIS invoice. Ignore "previous balance", "previous payment", "subtotal" — return the BOTTOM-LINE total.
- For invoice_number, strip any "INV-" / "#" prefix and return only the identifier (e.g. "1473", not "Invoice #1473").
- account_number and invoice_number are DIFFERENT. Utilities reuse the same account number every month but have a new invoice/bill number each time. If only one number is present and the bill is a utility, it is usually the account_number — put it there, not in invoice_number.
- If the document isn't an invoice (a statement, a receipt, a memo), set all fields to null and confidence below 0.3.
- Dates: be strict about ISO format. If the document shows "5/23/2026", convert to "2026-05-23".`

/** Extract structured fields from an invoice PDF. Throws on API
 *  failures; never throws on "this doesn't look like an invoice" —
 *  those come back as a low-confidence result for the caller to gate. */
export async function extractInvoiceFields(pdfBase64: string): Promise<ExtractedInvoice> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }
  const anthropic = new Anthropic()
  await assertClaudeBudget('invoice-extraction')
  const msg = await anthropic.messages.create({
    model:      EXTRACT_MODEL,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text',     text:   EXTRACTION_PROMPT },
      ],
    }],
  })

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  if (!text) {
    return emptyResult('Model returned an empty response')
  }
  return parseExtractionJson(text)
}

function emptyResult(_reason: string): ExtractedInvoice {
  return {
    vendorName:      null,
    invoiceNumber:   null,
    amount:          null,
    invoiceDate:     null,
    dueDate:         null,
    associationHint: null,
    accountNumber:   null,
    confidence:      0,
  }
}

function parseExtractionJson(raw: string): ExtractedInvoice {
  // Strip ```json … ``` fences if the model wrapped them despite the prompt.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let obj: Partial<Record<keyof ExtractedInvoice | string, unknown>>
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return emptyResult('JSON parse failed')
  }

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const cleaned = v.replace(/[^0-9.\-]/g, '')
      const n = parseFloat(cleaned)
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  const date = (v: unknown): string | null => {
    const s = str(v)
    if (!s) return null
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    // Fallback: try Date parsing, fail safe to null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const conf = (v: unknown): number => {
    const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN)
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(1, n))
  }

  return {
    vendorName:      str(obj.vendor_name),
    invoiceNumber:   str(obj.invoice_number),
    amount:          num(obj.amount),
    invoiceDate:     date(obj.invoice_date),
    dueDate:         date(obj.due_date),
    associationHint: str(obj.association_hint),
    accountNumber:   str(obj.account_number),
    confidence:      conf(obj.confidence),
  }
}
