// =====================================================================
// lib/sms-optin.ts
//
// The exact SMS opt-in consent wording. Shared by the opt-in webform and
// the API route so the text a user sees is the text recorded in the
// sms_consents ledger (TCR / A2P 10DLC requires storing the precise
// language the user agreed to).
//
// LEGAL ENTITY: Dawnus LLC (a Florida LLC) doing business as PMI Top
// Florida Properties. Twilio rejected our first A2P 10DLC submission
// citing "the provided website does not contain sufficient business
// information" — the underlying issue was that the brand registration
// names "Dawnus LLC" but every public-facing SMS surface (this consent
// text, the confirmation message, the opt-in page, the consent page)
// only said "PMI Top Florida Properties". Reviewers couldn't tie the
// brand to the legal entity. Every public reference must now identify
// BOTH names: "Dawnus LLC d/b/a PMI Top Florida Properties".
// =====================================================================

export const SMS_OPTIN_TEXT =
  'I agree to receive recurring SMS text messages from Dawnus LLC d/b/a PMI Top Florida Properties ' +
  'at the phone number provided — including account notices, payment reminders, ' +
  'maintenance updates, and community announcements. Message frequency varies. ' +
  'Message and data rates may apply. Reply HELP for help, or STOP to unsubscribe. ' +
  'Consent is not a condition of any purchase or service.'

// ---------------------------------------------------------------------
// The confirmation SMS sent as the user's first message after they opt in
// through the webform (Twilio-preferred "double opt-in"). This MUST match
// the "opt-in message" registered on the A2P 10DLC campaign verbatim, so
// keep the two in sync. It includes the brand name, an enrollment
// confirmation, frequency + data-rate disclosures, and HELP/STOP keywords.
// ---------------------------------------------------------------------
export const SMS_OPTIN_CONFIRMATION =
  'Dawnus LLC dba PMI Top Florida Properties: You are now opted in to receive ' +
  'account notices, payment reminders, maintenance updates, and community announcements. ' +
  'Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to unsubscribe.'
