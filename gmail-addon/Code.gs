/**
 * Maia — Gmail Workspace Add-on
 * ------------------------------------------------------------------
 * A right-sidebar panel for PMI Top Florida staff:
 *   • Homepage    → "My open tickets / work orders"
 *   • On an email → who/what this is, the matched ticket, recent history,
 *                   a guided "Create ticket / work order" form, quick
 *                   status actions, and an AI "Draft reply" button.
 *
 * It talks to Maia's backend (/api/addon/*) server-to-server via
 * UrlFetchApp, authenticated with a per-staff bearer token the user
 * pastes once on Maia's /admin/addon page.
 *
 * No ticket state lives here — this is a thin client over the same
 * tickets API the /admin queue uses.
 * ================================================================== */

// ---- config (per-user) ------------------------------------------------

function getConfig_() {
  var p = PropertiesService.getUserProperties();
  return { apiBase: (p.getProperty('MAIA_API_BASE') || '').replace(/\/+$/, ''), token: p.getProperty('MAIA_TOKEN') || '' };
}

function isConfigured_() {
  var c = getConfig_();
  return !!(c.apiBase && c.token);
}

// ---- HTTP helpers -----------------------------------------------------

function api_(method, path, body) {
  var c = getConfig_();
  var opts = {
    method: method,
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + c.token },
    contentType: 'application/json',
  };
  if (body) opts.payload = JSON.stringify(body);
  var res  = UrlFetchApp.fetch(c.apiBase + path, opts);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = {};
  try { json = JSON.parse(text); } catch (e) { /* non-json */ }
  if (code >= 400) throw new Error((json && json.error) || ('HTTP ' + code));
  return json;
}
function apiGet_(path)        { return api_('get', path, null); }
function apiPost_(path, body) { return api_('post', path, body); }
function apiPatch_(path, body){ return api_('patch', path, body); }

// ---- entry points -----------------------------------------------------

function onHomepage(e) {
  if (!isConfigured_()) return settingsCard_(true);
  var card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle('Maia').setSubtitle('My open items'));
  card.addSection(topBarSection_());
  try {
    var mineData = apiGet_('/api/addon/tickets?mine=1&status=open&limit=25');
    card.addSection(ticketsSection_(mineData.tickets || [], 'You have no open tickets or work orders. 🎉', '🎟️ My open items'));
    // All company open items — staff grab a TKT-#### to "@maia append" to a
    // thread. Split into work orders then tickets so the two don't mix.
    var allOpen = (apiGet_('/api/addon/tickets?mine=0&status=open&limit=50').tickets) || [];
    var openWOs = allOpen.filter(function (t) { return t.type === 'work_order'; });
    var openTks = allOpen.filter(function (t) { return t.type !== 'work_order'; });
    card.addSection(ticketsSection_(openWOs, 'No open work orders.', '🔧 Open work orders — company', true));
    card.addSection(ticketsSection_(openTks, 'No open tickets.', '🎟️ Open tickets — company', true));
  } catch (err) {
    card.addSection(errorSection_(err));
  }
  card.addSection(commandsSection_());
  card.addSection(associationsSection_());  // long reference, kept near the bottom
  card.addSection(settingsSection_());      // Settings pinned last
  return card.build();
}

function onGmailMessage(e) { return buildGmailCard_(e, null); }

// Re-render the card when the Association dropdown changes, forcing the
// picked code so the copy-text + create form reflect it.
function onAssociationChange(e) {
  var f = (e.commonEventObject && e.commonEventObject.formInputs) || {};
  var assoc = strInput_(f, 'association_code') || '';
  return CardService.newActionResponseBuilder()
    .setStateChanged(true)
    .setNavigation(CardService.newNavigation().updateCard(buildGmailCard_(e, assoc)))
    .build();
}

function buildGmailCard_(e, forcedAssoc) {
  if (!isConfigured_()) return settingsCard_(true);

  var ctx = readMessage_(e);  // { email, name, threadId, subject }
  var card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle('Maia').setSubtitle(ctx.email || 'This email'));
  card.addSection(topBarSection_());

  var data = {};
  try { data = apiGet_('/api/addon/context?gmailThreadId=' + encodeURIComponent(ctx.threadId) + '&email=' + encodeURIComponent(ctx.email)); }
  catch (err) { card.addSection(errorSection_(err)); card.addSection(settingsSection_()); return card.build(); }

  // ✨ Intelligence: read the body + suggest association and kind.
  var suggest = {};
  try { suggest = apiPost_('/api/addon/suggest', { subject: ctx.subject, body: ctx.body || '' }); } catch (sErr) { suggest = {}; }
  if (suggest && (suggest.association || (suggest.kind && suggest.kind !== 'ticket'))) {
    card.addSection(suggestSection_(suggest));
  }

  // Association picker at the TOP — it applies to everything below (create,
  // send-to-Maia), and now also carries the Unit lookup (who is on this
  // unit, by ANY persona — see lookupUnitAction). Pre-selected from the
  // suggestion. Pick by name.
  var assocList = [];
  try { assocList = (apiGet_('/api/addon/associations').associations) || []; } catch (aErr) { assocList = []; }
  card.addSection(associationPickerSection_(assocList, suggest, forcedAssoc));

  // 🏠 REPLY APPLICATIONS — moved to the top and left EXPANDED. This is the
  // primary workflow now (user direction, 2026-08-18), not something to find
  // after scrolling past tickets. Every field is a LIVE read of
  // getReviewState() on Maia's side — never a cached snapshot.
  //
  // A real error here used to be silently swallowed and look IDENTICAL to
  // "no application matched" — indistinguishable to staff, and exactly what
  // caused a live bug to be mistaken for "this feature doesn't do anything."
  // Now it renders visibly instead of vanishing.
  try {
    var appData = apiGet_('/api/addon/applications?gmailThreadId=' + encodeURIComponent(ctx.threadId) + '&email=' + encodeURIComponent(ctx.email));
    if (appData && appData.matched) applicationSection_(appData.matched, ctx).forEach(function (sec) { card.addSection(sec); });
  } catch (appErr) {
    var appErrSection = CardService.newCardSection().setHeader('🏠 Application');
    appErrSection.addWidget(CardService.newTextParagraph().setText('⚠️ Could not check for a matching application: ' + (appErr && appErr.message ? appErr.message : String(appErr))));
    card.addSection(appErrSection);
  }

  // 🎫 MY TICKETS — matched/linked ticket, its own AI draft, and recent
  // history for this contact, grouped under one collapsible header instead
  // of three separate top-level sections.
  card.addSection(myTicketsSection_(data, ctx));

  // ➕ OPEN NEW TICKET / WORK ORDER — the guided create form. Collapsed by
  // default now that Applications is the primary path; still one click away.
  var staffList = [];
  try { staffList = (apiGet_('/api/addon/staff').staff) || []; } catch (stErr) { staffList = []; }
  var createSec = createSection_(ctx, data, suggest, staffList);
  createSec.setCollapsible(true).setNumUncollapsibleWidgets(0);
  card.addSection(createSec);

  // 🏢 Company-wide open items — pick a TKT-#### to "@maia append" this
  // email to. Work orders first, then tickets.
  try {
    var allOpen2 = (apiGet_('/api/addon/tickets?mine=0&status=open&limit=50').tickets) || [];
    var openWOs2 = allOpen2.filter(function (t) { return t.type === 'work_order'; });
    var openTks2 = allOpen2.filter(function (t) { return t.type !== 'work_order'; });
    card.addSection(ticketsSection_(openWOs2, 'No open work orders.', '🔧 Open work orders — company', true, ctx));
    card.addSection(ticketsSection_(openTks2, 'No open tickets.', '🎟️ Open tickets — company', true, ctx));
  } catch (errAll) { /* non-fatal — keep the rest of the card */ }

  card.addSection(commandsSection_());
  card.addSection(associationsSection_());  // long reference, kept near the bottom
  card.addSection(settingsSection_());      // Settings pinned last
  return card.build();
}

function onSettings(e) { return settingsCard_(false); }

// ---- card builders ----------------------------------------------------

// One ticket/WO row, shared by every section that lists them (company-wide
// lists here, and the "My tickets" group below) — extracted so the row
// layout is defined exactly once.
function ticketRowWidget_(t, linkCtx) {
  var c = getConfig_();
  var dot = ({ open: '🟢', pending: '🟡', waiting_external: '🔵', resolved: '⚪', closed: '⚫' })[t.status] || '⚪';
  var kind = t.type === 'work_order' ? '🔧 WO' : '🎟️ Ticket';
  var line = CardService.newDecoratedText()
    .setTopLabel(dot + '  ' + t.ticket_number + '  ·  ' + (t.status || ''))
    .setText((t.subject || '(no subject)'))
    .setBottomLabel([kind, t.association_code || '', t.priority || ''].filter(Boolean).join('  ·  '))
    .setWrapText(true)
    .setOpenLink(CardService.newOpenLink().setUrl(c.apiBase + '/admin/tickets/' + t.id));
  if (linkCtx && (linkCtx.threadId || linkCtx.messageId)) {
    line.setButton(CardService.newTextButton().setText('🔗 Link')
      .setOnClickAction(CardService.newAction().setFunctionName('linkEmailAction').setParameters({
        ticketId:   String(t.id),
        ticketNo:   t.ticket_number || '',
        threadId:   linkCtx.threadId || '',
        messageId:  linkCtx.messageId || '',
        subject:    linkCtx.subject || '',
        sender:     linkCtx.email || '',
      })));
  }
  return line;
}

function ticketsSection_(tickets, emptyText, headerText, collapsible, linkCtx) {
  var s = CardService.newCardSection();
  if (headerText) s.setHeader(headerText);
  if (collapsible) s.setCollapsible(true).setNumUncollapsibleWidgets(3);
  if (!tickets.length) { s.addWidget(CardService.newTextParagraph().setText(emptyText || 'Nothing here.')); return s; }
  tickets.forEach(function (t) { s.addWidget(ticketRowWidget_(t, linkCtx)); });
  return s;
}

// "🎫 My tickets" — the linked/matched ticket (with status control), the
// ticket AI draft, and recent history for this contact, grouped under one
// collapsible header instead of three separate top-level sections. The
// draft button is explicitly labelled "(ticket)" — it used to just say
// "Draft reply" with no way to tell it apart from the Application section's
// own draft button below, and that exact ambiguity is what this whole
// reorganisation was prompted by.
function myTicketsSection_(data, ctx) {
  var s = CardService.newCardSection().setHeader('🎫 My tickets for this email');
  s.setCollapsible(true).setNumUncollapsibleWidgets(2);

  if (data.matched) {
    var t = data.matched;
    s.addWidget(CardService.newDecoratedText()
      .setTopLabel('🔗 Linked ' + (t.type === 'work_order' ? 'work order' : 'ticket') + '  ·  ' + t.ticket_number)
      .setText(t.subject || '(no subject)')
      .setBottomLabel('Status: ' + (t.status || '') + (t.assignee_email ? ('  ·  ' + t.assignee_email) : '  ·  unassigned'))
      .setWrapText(true));
    var statusInput = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
      .setTitle('Set status').setFieldName('status');
    ['open', 'pending', 'waiting_external', 'resolved', 'closed'].forEach(function (st) {
      statusInput.addItem(st, st, st === t.status);
    });
    s.addWidget(statusInput);
    s.addWidget(CardService.newTextButton().setText('Update status')
      .setOnClickAction(CardService.newAction().setFunctionName('setStatusAction').setParameters({ ticketId: String(t.id) })));
  } else {
    s.addWidget(CardService.newTextParagraph().setText('No ticket linked to this email yet.'));
  }

  s.addWidget(CardService.newTextButton().setText('✨ Draft reply (ticket)')
    .setOnClickAction(CardService.newAction().setFunctionName('draftReplyAction')
      .setParameters({ ticketId: data.matched ? String(data.matched.id) : '', threadId: ctx.threadId || '', email: ctx.email || '', subject: ctx.subject || '' })));

  if (data.recent && data.recent.length) {
    s.addWidget(CardService.newTextParagraph().setText('<b>Recent for this contact</b>'));
    data.recent.forEach(function (t2) { s.addWidget(ticketRowWidget_(t2, ctx)); });
  }
  return s;
}

// Which of the three form-backed checklist items this is, and what to call
// it — kept in step with lib/application-esign-forms.ts → ESIGN_CHECKLIST_ITEMS.
// Presentation only; the backend is the actual source of truth for which
// doc_keys are forms at all (isEsignItem), so a docKey missing from this map
// still renders — just with its raw key instead of a friendly name.
var APPLICATION_FORM_LABEL_ = {
  governing_docs_ack: 'Rules Knowledge Acknowledgment',
  pet_registration:   'Pet Registration',
  emergency_contact:  'Emergency Contact List',
};

// The matched application: unit, applicants, what's approved vs still
// outstanding, named — not just counted — and a one-click Send button for
// each of the three form-backed items still waiting. This is the section
// that replaces "reply and ask, wait, repeat": whatever the sender claims
// was already sent, this shows what MAIA actually has on file right now.
function applicationSection_(a, ctx) {
  var s = CardService.newCardSection().setHeader('🏠 Application — ' + (a.associationCode || '') + (a.unitLabel ? (' · Unit ' + a.unitLabel) : ''));

  // THE primary action: the standard reply — thank them, redirect to the
  // self-serve upload link, list what's outstanding — instead of staff
  // filing the attachment by hand. Same shape every time, which is the
  // point: a reply nobody customizes case-by-case is one an agent could
  // eventually send without a human rewriting it. For now it only drafts;
  // see draftApplicationReplyAction.
  s.addWidget(CardService.newTextButton().setText('📨 Draft: ask them to upload')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('draftApplicationReplyAction')
      .setParameters({ applicationId: String(a.id), threadId: ctx.threadId || '', email: ctx.email || '', name: ctx.name || '' })));

  var statusLabel = { started: 'Collecting documents', submitted: 'Submitted', under_review: 'Under review', approved: 'Approved', declined: 'Declined' }[a.status] || a.status;
  s.addWidget(CardService.newDecoratedText()
    .setTopLabel((a.applicants || []).join(', ') || 'Applicant')
    .setText(statusLabel + '  ·  ' + (a.totals ? (a.totals.approved + '/' + a.totals.required + ' approved') : ''))
    .setWrapText(true)
    .setOpenLink(CardService.newOpenLink().setUrl(getConfig_().apiBase + '/admin/pre-apply/' + a.id)));

  if (a.missing && a.missing.length) {
    s.addWidget(CardService.newTextParagraph().setText(
      '<b>Still outstanding:</b><br>' + a.missing.slice(0, 6).map(function (m) { return '• ' + m; }).join('<br>') +
      (a.missing.length > 6 ? ('<br>+' + (a.missing.length - 6) + ' more') : '')));
  }
  if (a.refused && a.refused.length) {
    s.addWidget(CardService.newTextParagraph().setText(
      '<font color="#b42318"><b>Sent back:</b></font><br>' +
      a.refused.map(function (r) { return '• ' + r.label + (r.reason ? (' — ' + r.reason) : ''); }).join('<br>')));
  }
  if (a.dueAt) {
    s.addWidget(CardService.newTextParagraph().setText('Board decision due by <b>' + a.dueAt.slice(0, 10) + '</b>'));
  }

  // Per-signer status for anything already sent — "staff visibility per
  // person" (user direction, 2026-08-18). A flat "waiting" said nothing
  // about a Rules Ack sent to two people where one signed and one is
  // blocked; this names each of them and whether THEY specifically signed.
  (a.inFlight || []).forEach(function (f) {
    var lines = (f.signers || []).map(function (sg) {
      return (sg.signed ? '✓' : '○') + ' ' + (sg.name || sg.email || '(no name)') + (sg.signed ? '' : (sg.email ? '' : ' — no email on file'));
    }).join('<br>');
    s.addWidget(CardService.newTextParagraph().setText('<b>' + f.noun + '</b> (' + f.status + '):<br>' + (lines || 'no signers on file')));
  });

  // One button per form-backed item still waiting. Sending is the SAME
  // sendEsignFormsForItems() the staff screen calls — there is no second way
  // these three documents get created.
  (a.sendable || []).forEach(function (docKey) {
    var label = APPLICATION_FORM_LABEL_[docKey] || docKey;
    s.addWidget(CardService.newTextButton().setText('📩 Send ' + label)
      .setOnClickAction(CardService.newAction().setFunctionName('sendFormAction')
        .setParameters({ applicationId: String(a.id), docKey: docKey, label: label })));
  });
  if (!a.sendable || !a.sendable.length) {
    s.addWidget(CardService.newTextParagraph().setText('<i>No outstanding form-backed items to send.</i>'));
  }

  // Recent history — every prior drafted request + filed correspondence,
  // right in the sidebar instead of only on the admin page. User direction,
  // 2026-08-19: "I want all previous request and communications in a list
  // under like a box HISTORY." One DecoratedText row per entry (icon + date
  // + subject) rather than a single wall of text — CardService's version of
  // "beautifully formatted," which is as far as a sidebar card can go; the
  // application link above still opens the full timeline (document
  // decisions, signed approval letters) for anything this compact list
  // doesn't carry.
  if (a.history && a.history.length) {
    var hist = CardService.newCardSection().setHeader('📜 Recent history').setCollapsible(true).setNumUncollapsibleWidgets(2);
    a.history.forEach(function (h) {
      var icon = h.direction === 'inbound' ? '📥' : h.direction === 'note' ? '📝' : '📤';
      var date = (h.occurredAt || '').slice(0, 10);
      hist.addWidget(CardService.newDecoratedText()
        .setTopLabel(date + (h.toEmails && h.toEmails.length ? ('  ·  ' + h.toEmails.join(', ')) : ''))
        .setText(icon + ' ' + h.subject)
        .setWrapText(true));
    });
    return [s, hist];
  }

  return [s];
}

// "✨ Maia suggests" — what the email looks like + which association.
function suggestSection_(sg) {
  var s = CardService.newCardSection().setHeader('✨ Maia suggests');
  var kindLabel = sg.kind === 'invoice' ? 'Invoice' : sg.kind === 'work_order' ? 'Work order' : 'Ticket';
  var headline = kindLabel + (sg.association ? ('  ·  ' + sg.association) : '');
  s.addWidget(CardService.newDecoratedText()
    .setText('<b><font color="#f26a1b">' + headline + '</font></b>')
    .setBottomLabel(sg.reason || '').setWrapText(true));
  if (sg.kind === 'invoice') {
    s.addWidget(CardService.newTextParagraph().setText(
      'Looks like an invoice — forward to <b>maia@pmitop.com</b> with <font color="#f26a1b">@maia upload this invoice ' +
      (sg.association ? ('#' + sg.association) : '#CODE') + '</font> (attach the PDF).'));
  }
  return s;
}

// Association picker at the top — a dropdown of every association by
// CODE · Name, pre-selected from the suggestion. Field 'association_code'
// is card-wide, so both Create and Send-invoice read it.
function associationPickerSection_(assocList, suggest, forcedAssoc) {
  suggest = suggest || {};
  var selected = String(forcedAssoc || suggest.association || '').toUpperCase();
  var s = CardService.newCardSection().setHeader('🏢 Association (applies to all below)');
  // No setTitle — a floating label overlaps the value (garbles). Re-renders
  // the card on change so the copy-text below reflects the pick.
  var dd = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('association_code')
    .setOnChangeAction(CardService.newAction().setFunctionName('onAssociationChange'));
  dd.addItem('— choose —', '', !selected);   // placeholder first
  (assocList || []).forEach(function (a) {
    if (a && a.code) dd.addItem(a.code + ' · ' + (a.name || ''), a.code, a.code.toUpperCase() === selected);
  });
  s.addWidget(dd);

  // Dynamic invoice-forward helper — copy this into a Forward to maia@.
  if (selected) {
    s.addWidget(CardService.newDecoratedText()
      .setTopLabel('Invoice? Forward to maia@pmitop.com — copy:')
      .setText('<font color="#f26a1b"><b>@maia upload this invoice #' + selected + '</b></font>')
      .setBottomLabel('Use Forward (not Reply — Reply drops the PDF).')
      .setWrapText(true));
  }

  // Unit picker — "who is on the other end of this email", as an explicit
  // check rather than a guess. Automatic thread/email matching (the 🏠
  // Application section above) covers the common case; this is the
  // verification tool for when it's genuinely unclear whether the sender is
  // the owner, the tenant, or an agent — the exact gap the playbook flags as
  // having no automated answer. Also feeds the "Create → Application Link"
  // flow below (same card-wide 'lookup_unit' field, one picker for both).
  //
  // A real DROPDOWN of the association's actual units, not free text — staff
  // report, 2026-09-03: typing a unit by hand was error-prone (typos silently
  // matched nothing) and the whole point of the association dropdown above is
  // picking from real records, not retyping them. /api/associations/units is
  // public (no add-on auth needed) and already backs the /apply wizard's own
  // unit picker.
  if (selected) {
    var units = [];
    try { units = apiGet_('/api/associations/units?code=' + encodeURIComponent(selected)) || []; } catch (uErr) { units = []; }
    var unitDd = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
      .setTitle('Unit number').setFieldName('lookup_unit');
    unitDd.addItem('— choose —', '', true);
    units.forEach(function (u) { unitDd.addItem(String(u), String(u), false); });
    s.addWidget(unitDd);
    s.addWidget(CardService.newTextButton().setText('🔍 Who is on this unit?')
      .setOnClickAction(CardService.newAction().setFunctionName('lookupUnitAction').setParameters({ association_code: selected })));
  }
  return s;
}

function createSection_(ctx, data, suggest, staffList) {
  suggest = suggest || {};
  staffList = staffList || [];
  var s = CardService.newCardSection().setHeader(data.matched ? '➕ Create another item' : '➕ Create ticket / work order');

  var woFirst = suggest.kind === 'work_order';   // pre-select Work order when suggested
  // 'Application Link' folded in here rather than its own button elsewhere —
  // staff report, 2026-09-03: a separate button in the Association section
  // for one specific thing was confusing next to this already-familiar
  // pick-a-type-then-Create flow. Picking it and hitting Create/Create
  // another skips Priority/Assignee/Subject/Notes below (createTicketAction)
  // and instead checks the unit (from the picker above) for an open
  // application and hands back a ready-to-paste reply with the pre-apply
  // link — see preapplyLinkAction's twin path in createTicketAction.
  s.addWidget(CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Type').setFieldName('type')
    .addItem('Ticket', 'ticket', !woFirst)
    .addItem('Work order', 'work_order', woFirst)
    .addItem('Application Link', 'application_link', false));

  s.addWidget(CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Priority').setFieldName('priority')
    .addItem('Low', 'low', false).addItem('Normal', 'normal', true)
    .addItem('High', 'high', false).addItem('Urgent', 'urgent', false));

  // Assign to — anyone, defaulting to "Me" (empty value = the caller).
  var assignInput = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Assign to').setFieldName('assignee')
    .addItem('Me', 'me', true);
  staffList.forEach(function (m) {
    if (m && m.email) assignInput.addItem(m.name || m.email, m.email, false);
  });
  s.addWidget(assignInput);

  // Association is chosen in the picker at the top of the card (its value
  // is card-wide), so it's not repeated here.
  s.addWidget(CardService.newTextInput().setFieldName('subject').setTitle('Subject')
    .setValue(ctx.subject || ''));

  s.addWidget(CardService.newTextInput().setFieldName('note').setTitle('Instructions / notes for Maia').setMultiline(true));

  s.addWidget(CardService.newTextButton().setText(data.matched ? 'Create another' : 'Create')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('createTicketAction')
      .setParameters({ threadId: ctx.threadId, email: ctx.email, contactName: ctx.name || '' })));

  // (Invoice-forward copy-text lives in the Association picker at the top,
  // where it updates with the chosen code.)
  return s;
}

function settingsCard_(prompt) {
  var c = getConfig_();
  var card = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle('Maia — connect').setSubtitle('Paste your token from Maia'));
  var s = CardService.newCardSection();
  if (prompt) s.addWidget(CardService.newTextParagraph().setText(
    'Open <b>Maia → /admin/addon</b> in your browser, copy the two values, and paste them here.'));
  s.addWidget(CardService.newTextInput().setFieldName('apiBase').setTitle('API base URL')
    .setValue(c.apiBase || 'https://www.pmitop.com'));
  s.addWidget(CardService.newTextInput().setFieldName('token').setTitle('Add-on token').setValue(c.token || ''));
  s.addWidget(CardService.newTextButton().setText('Save').setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('saveSettings')));
  card.addSection(s);
  return card.build();
}

function errorSection_(err) {
  return CardService.newCardSection().addWidget(
    CardService.newTextParagraph().setText('⚠️ ' + (err && err.message ? err.message : String(err))));
}

// Primary action, pinned at the TOP of every card.
function topBarSection_() {
  var c = getConfig_();
  var s = CardService.newCardSection();
  s.addWidget(CardService.newTextButton().setText('Open Maia Platform')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOpenLink(CardService.newOpenLink().setUrl(c.apiBase + '/admin')));
  return s;
}

// Settings, pinned at the very BOTTOM of every card.
function settingsSection_() {
  var s = CardService.newCardSection();
  s.addWidget(CardService.newTextButton().setText('Settings')
    .setOnClickAction(CardService.newAction().setFunctionName('onSettings')));
  return s;
}

// Collapsible reference of association codes so staff know what to type for
// the "#CODE" association tag (e.g. "@maia upload this invoice #ONE").
function associationsSection_() {
  var s = CardService.newCardSection().setHeader('🏢 Association codes (tag with #CODE)');
  s.setCollapsible(true).setNumUncollapsibleWidgets(1);
  s.addWidget(CardService.newTextParagraph().setText(
    'Add <font color="#f26a1b"><b>#CODE</b></font> anywhere in your email to tag the association — e.g. <b>@maia upload this invoice #ONE</b>.'));
  try {
    var data = apiGet_('/api/addon/associations');
    (data.associations || []).forEach(function (a) {
      s.addWidget(CardService.newDecoratedText()
        .setText('<font color="#f26a1b"><b>#' + a.code + '</b></font>')
        .setBottomLabel(a.name).setWrapText(true));
    });
  } catch (err) {
    s.addWidget(CardService.newTextParagraph().setText('Could not load association codes.'));
  }
  return s;
}

// Collapsible cheat-sheet of MAIA email commands staff can copy into the
// body of an email to maia@pmitop.com. Selectable text → tap to copy.
function commandsSection_() {
  var c = getConfig_();
  var s = CardService.newCardSection().setHeader('🧩 MAIA commands (type in the email body)');
  s.setCollapsible(true).setNumUncollapsibleWidgets(1);
  s.addWidget(CardService.newTextParagraph().setText(
    'Email <b>maia@pmitop.com</b> with any of these in the body. Tap a line to select and copy.'));
  function row(label, cmd) {
    s.addWidget(CardService.newDecoratedText().setTopLabel(label)
      .setText('<font color="#f26a1b">' + cmd + '</font>').setWrapText(true));
  }
  row('Create ticket',          '@maia ticket   (or @ticket)');
  row('Open work order',        '@maia work order');
  row('Assign someone',         '@assign jane@pmitop.com');
  row('Set priority',           '@priority urgent   (urgent / high / normal / low)');
  row('Tag the association',    '#ONE   (any code — see list below)');
  row('Process an invoice',     '@maia upload this invoice #ONE   (attach the PDF)');
  row('Add to existing ticket', '@maia append TKT-2026-0001');
  row('Add records',            '@maia add owner / tenant / board member / agent / vendor');
  row('Replace a board',        '@maia update board members   (then list the new board)');
  s.addWidget(CardService.newTextButton().setText('Full command guide →')
    .setOpenLink(CardService.newOpenLink().setUrl(c.apiBase + '/admin/help')));
  return s;
}

// ---- action handlers --------------------------------------------------

function saveSettings(e) {
  var f = e.commonEventObject.formInputs || {};
  var apiBase = strInput_(f, 'apiBase');
  var token   = strInput_(f, 'token');
  PropertiesService.getUserProperties().setProperty('MAIA_API_BASE', apiBase).setProperty('MAIA_TOKEN', token);
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Saved. Maia is connected.'))
    .setNavigation(CardService.newNavigation().updateCard(onHomepage(e)))
    .build();
}

function createTicketAction(e) {
  var p = e.commonEventObject.parameters || {};
  var f = e.commonEventObject.formInputs || {};
  // 'Application Link' shares this button (see createSection_) but is a
  // totally different action than ticket/work-order creation — hand off to
  // preapplyLinkAction's own logic (checks for an open application on the
  // unit, hands back a copy-page draft) instead of falling through to
  // tickets/ensure below.
  if (strInput_(f, 'type') === 'application_link') return preapplyLinkAction(e);
  try {
    var assignee = strInput_(f, 'assignee');   // 'me'/'' = caller, else a staff email
    if (assignee === 'me') assignee = '';
    var res = apiPost_('/api/addon/tickets/ensure', {
      type:             strInput_(f, 'type') || 'ticket',
      priority:         strInput_(f, 'priority') || 'normal',
      association_code: strInput_(f, 'association_code') || null,
      subject:          strInput_(f, 'subject') || null,
      note:             strInput_(f, 'note') || null,
      contact_email:    p.email || null,
      contact_name:     p.contactName || null,
      gmail_thread_id:  p.threadId || null,
      assignee_email:   assignee || null,
      assignToMe:       assignee ? false : true,
    });
    var t = res.ticket || {};
    var who = assignee ? (' → ' + assignee) : ' → you';
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(
        (res.created ? 'Created ' : 'Linked existing ') + (t.ticket_number || 'ticket') + who))
      .setNavigation(CardService.newNavigation().updateCard(onGmailMessage(e)))
      .build();
  } catch (err) {
    return notify_(err);
  }
}

function setStatusAction(e) {
  var p = e.commonEventObject.parameters || {};
  var f = e.commonEventObject.formInputs || {};
  try {
    apiPatch_('/api/addon/tickets/' + p.ticketId, { status: strInput_(f, 'status') });
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Status updated.'))
      .setNavigation(CardService.newNavigation().updateCard(onGmailMessage(e)))
      .build();
  } catch (err) { return notify_(err); }
}

// Send one of the three form-backed application items (Rules Ack / Pet
// Registration / Emergency Contact List) without leaving Gmail. Re-renders
// the card afterward so the button disappears once the item is no longer
// outstanding — the same live-state read that built the card in the first
// place, not a locally-guessed "it worked so hide the button" shortcut.
function sendFormAction(e) {
  var p = e.commonEventObject.parameters || {};
  try {
    apiPost_('/api/addon/applications/' + encodeURIComponent(p.applicationId) + '/send-form', { docKey: p.docKey });
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('✓ Sent ' + (p.label || p.docKey)))
      .setNavigation(CardService.newNavigation().updateCard(onGmailMessage(e)))
      .build();
  } catch (err) { return notify_(err); }
}

// Build a FORWARD draft to maia@ (keeps attachments, unlike a reply) with
// the "@maia upload this invoice #CODE" trigger pre-filled. Lands in the
// user's Drafts to review + Send.
function forwardToMaiaAction(e) {
  var p = e.commonEventObject.parameters || {};
  var f = e.commonEventObject.formInputs || {};
  try {
    var token = e.gmail.accessToken;
    GmailApp.setCurrentMessageAccessToken(token);
    var msg = GmailApp.getMessageById(e.gmail.messageId);
    var assoc = strInput_(f, 'association_code') || p.association || '';
    var trigger = '@maia upload this invoice' + (assoc ? (' #' + assoc) : ' #CODE');

    // Real attachments on the open message (skip inline logos). Only the
    // current message — reading the whole thread needs a broad Gmail scope.
    var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });

    var html = '<p>' + trigger + '</p><hr>' + (msg.getBody() || '');
    GmailApp.createDraft('maia@pmitop.com', 'Fwd: ' + (msg.getSubject() || ''), trigger, {
      htmlBody:    html,
      attachments: atts,
    });

    // Confirm exactly what was attached so the PDF is never silently dropped.
    var names = atts.map(function (a) { return a.getName(); }).join(', ');
    var note = atts.length
      ? ('📤 Draft to Maia' + (assoc ? ' #' + assoc : '') + ' with ' + atts.length +
         ' file(s): ' + names.slice(0, 100) + ' — review in Drafts & Send.')
      : ('⚠ Draft to Maia created, but NO attachment was found on this email/thread — attach the PDF before sending.');
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(note))
      .build();
  } catch (err) { return notify_(err); }
}

// Link the open email to the chosen ticket (records the association + a
// note on the ticket). A toast confirms; no card refresh needed.
function linkEmailAction(e) {
  var p = e.commonEventObject.parameters || {};
  try {
    var res = apiPost_('/api/addon/tickets/' + encodeURIComponent(p.ticketId) + '/link-email', {
      gmailThreadId:  p.threadId  || '',
      gmailMessageId: p.messageId || '',
      subject:        p.subject   || '',
      sender:         p.sender    || '',
    });
    var num = res.ticket_number || p.ticketNo || 'ticket';
    var msg = res.already ? ('Already linked to ' + num) : ('🔗 Linked this email to ' + num);
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(msg))
      .build();
  } catch (err) { return notify_(err); }
}

function draftReplyAction(e) {
  var p = e.commonEventObject.parameters || {};
  try {
    var ticketId = p.ticketId;
    // No ticket yet → create/link one first so the draft has context.
    if (!ticketId) {
      var ensured = apiPost_('/api/addon/tickets/ensure', {
        contact_email: p.email || null, gmail_thread_id: p.threadId || null, subject: p.subject || null, assignToMe: true,
      });
      ticketId = String(ensured.ticket.id);
    }
    var res = apiPost_('/api/addon/tickets/' + ticketId + '/draft', {});
    var draft = res.draftText || '(no draft returned)';
    // Stash the draft so the compose action can insert it for this thread.
    CacheService.getUserCache().put('draft_' + (p.threadId || ticketId), draft, 1800);

    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Draft reply'));
    var s = CardService.newCardSection();
    // Card UI has no clipboard-write API — a tap-to-select-and-copy TextInput
    // wasn't discoverable enough (asked twice), so the REAL copy button is a
    // link to an actual webpage (normal browser JS, full navigator.clipboard).
    // The TextInput stays too, as a quick preview and a fallback.
    if (res.viewToken) {
      s.addWidget(CardService.newTextButton().setText('📋 Open to copy')
        .setOpenLink(CardService.newOpenLink().setUrl(getConfig_().apiBase + '/addon/draft/' + res.viewToken)));
    }
    s.addWidget(CardService.newTextInput().setFieldName('draft_text').setMultiline(true).setValue(draft));
    s.addWidget(CardService.newTextParagraph().setText(
      '<i>Or hit Reply in Gmail, then "Insert Maia draft".</i>'));
    card.addSection(s);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card.build())).build();
  } catch (err) { return notify_(err); }
}

// The standard application reply. Stashes the draft under the SAME cache key
// draftReplyAction uses ('draft_' + threadId) — onComposeInsertDraft below is
// already generic over that key, so hitting Reply → "Insert Maia draft" picks
// this up with no separate insert path to build or keep in sync.
function draftApplicationReplyAction(e) {
  var p = e.commonEventObject.parameters || {};
  try {
    var res = apiPost_('/api/addon/applications/' + encodeURIComponent(p.applicationId) + '/draft-reply', {
      senderEmail: p.email || '', senderName: p.name || '',
    });
    var draft = res.draftText || '(no draft returned)';
    CacheService.getUserCache().put('draft_' + (p.threadId || p.applicationId), draft, 1800);

    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Draft reply — ask them to upload'));
    var s = CardService.newCardSection();
    // See draftReplyAction above — a real webpage with a real Copy button,
    // not just a select-it-yourself TextInput. User direction, 2026-08-18 AND
    // 2026-08-19 (asked twice): "why I don't have on the side card a copy
    // button?" / "there was not COPY button."
    if (res.viewToken) {
      s.addWidget(CardService.newTextButton().setText('📋 Open to copy')
        .setOpenLink(CardService.newOpenLink().setUrl(getConfig_().apiBase + '/addon/draft/' + res.viewToken)));
    }
    s.addWidget(CardService.newTextInput().setFieldName('draft_text').setMultiline(true).setValue(draft));
    s.addWidget(CardService.newTextParagraph().setText(
      '<i>Or hit Reply in Gmail, then "Insert Maia draft". Review the staff note at the bottom (if any) and delete it before sending — it is not meant for the resident.</i>'));
    card.addSection(s);
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(res.nothingOutstanding ? 'Nothing outstanding — drafted a plain thank-you.' : 'Draft ready.'))
      .setNavigation(CardService.newNavigation().pushCard(card.build())).build();
  } catch (err) { return notify_(err); }
}

// For a unit with no application started yet (or one already in progress —
// see the openApplication note below) — an agent forwarding "please send me
// the rental application" is the exact real case this closes. Same copy-page
// + compose-insert pattern as the two draft actions above, so it slots into
// the same "hit Reply → Insert Maia draft" muscle memory. Reads the sender's
// name fresh off the open message (readMessage_) rather than a passed
// parameter, since the shared 'Create' button that triggers this (via
// createTicketAction, when Type = 'Application Link') carries threadId/
// email/contactName, not a name. association_code and lookup_unit are the
// same card-wide fields the association picker's dropdowns already set.
function preapplyLinkAction(e) {
  var p = e.commonEventObject.parameters || {};
  var f = e.commonEventObject.formInputs || {};
  var ctx = readMessage_(e);
  var assoc = strInput_(f, 'association_code');
  if (!assoc) return notify_({ message: 'Choose an association first.' });
  try {
    var res = apiPost_('/api/addon/preapply-link', {
      association_code: assoc,
      unit: strInput_(f, 'lookup_unit') || '',
      to_name: ctx.name || '',
    });
    var draft = res.draftText || res.url || '(no draft returned)';
    CacheService.getUserCache().put('draft_' + (ctx.threadId || assoc), draft, 1800);

    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Application link — ready to send'));
    var s = CardService.newCardSection();
    // Staff report, 2026-09-03: two different agents both asked for "the"
    // application on the same unit -- flagged here, up front, rather than
    // discovered only after the reply already went out. The link itself is
    // still correct to send either way (see preapply-link/route.ts's
    // dedupe note), this is just so it's not a surprise.
    if (res.openApplication) {
      s.addWidget(CardService.newTextParagraph().setText(
        '⚠️ An application for this unit is already in progress, started by <b>' + (res.openApplication.leadName || 'someone') +
        '</b>. This link is still safe to send — whoever opens it next joins that same application instead of starting a duplicate.'));
    }
    if (res.viewToken) {
      s.addWidget(CardService.newTextButton().setText('📋 Open to copy')
        .setOpenLink(CardService.newOpenLink().setUrl(getConfig_().apiBase + '/addon/draft/' + res.viewToken)));
    }
    s.addWidget(CardService.newTextInput().setFieldName('draft_text').setMultiline(true).setValue(draft));
    s.addWidget(CardService.newTextParagraph().setText(
      '<i>Or hit Reply in Gmail, then "Insert Maia draft".</i>'));
    card.addSection(s);
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(res.openApplication ? 'Draft ready — application already in progress, see note.' : 'Draft ready.'))
      .setNavigation(CardService.newNavigation().pushCard(card.build())).build();
  } catch (err) { return notify_(err); }
}

// Every persona tied to a unit, in one read — owner(s), tenant, and (if
// there's an open application) its full roster plus any agents on it. Pushed
// as its own card, same pattern as the other draft/lookup actions.
function lookupUnitAction(e) {
  var p = e.commonEventObject.parameters || {};
  var f = e.commonEventObject.formInputs || {};
  var assoc = p.association_code || '';
  var unit = strInput_(f, 'lookup_unit');
  if (!unit) return notify_({ message: 'Enter a unit number first.' });
  try {
    var r = apiGet_('/api/addon/unit-lookup?assoc=' + encodeURIComponent(assoc) + '&unit=' + encodeURIComponent(unit));
    var card = CardService.newCardBuilder().setHeader(CardService.newCardHeader().setTitle('Unit ' + unit).setSubtitle(assoc));
    var s = CardService.newCardSection();

    s.addWidget(CardService.newTextParagraph().setText('<b>Owner' + (r.owners.length > 1 ? 's' : '') + '</b>'));
    if (!r.owners.length) s.addWidget(CardService.newTextParagraph().setText('No owner on file.'));
    r.owners.forEach(function (o) {
      s.addWidget(CardService.newDecoratedText()
        .setText(o.name || '(no name)')
        .setBottomLabel([].concat(o.emails || [], o.phone ? [o.phone] : []).join('  ·  ') || 'no contact on file')
        .setWrapText(true));
    });

    s.addWidget(CardService.newTextParagraph().setText('<b>Tenant</b>'));
    if (r.tenant) {
      s.addWidget(CardService.newDecoratedText()
        .setText(r.tenant.name || '(no name)')
        .setBottomLabel([r.tenant.email, r.tenant.phone].filter(Boolean).join('  ·  ') || 'no contact on file')
        .setWrapText(true));
    } else {
      s.addWidget(CardService.newTextParagraph().setText('No tenant on file for this unit.'));
    }

    if (r.applicationId) {
      s.addWidget(CardService.newTextParagraph().setText('<b>Open application</b> — ' + (r.applicationType || '') + '  ·  ' + (r.applicationStatus || '')));
      (r.applicants || []).forEach(function (a) {
        s.addWidget(CardService.newDecoratedText()
          .setTopLabel(a.role || 'applicant')
          .setText(a.name || '(no name)')
          .setBottomLabel([a.email, a.phone].filter(Boolean).join('  ·  ') || 'no contact on file')
          .setWrapText(true));
      });
      (r.agents || []).forEach(function (ag) {
        s.addWidget(CardService.newDecoratedText()
          .setTopLabel(ag.label)
          .setText(ag.name || '(no name)')
          .setBottomLabel([ag.email, ag.phone].filter(Boolean).join('  ·  ') || 'no contact on file')
          .setWrapText(true));
      });
    } else {
      s.addWidget(CardService.newTextParagraph().setText('No open application on this unit.'));
    }

    card.addSection(s);
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card.build())).build();
  } catch (err) { return notify_(err); }
}

/** Compose select-action: insert the most recent draft for this thread. */
function onComposeInsertDraft(e) {
  var threadId = e.gmail && e.gmail.threadId ? e.gmail.threadId : '';
  var draft = CacheService.getUserCache().get('draft_' + threadId) || '';
  return CardService.newUpdateDraftActionResponseBuilder()
    .setUpdateDraftBodyAction(CardService.newUpdateDraftBodyAction()
      .addUpdateContent(draft.replace(/\n/g, '<br>'), CardService.ContentType.MUTABLE_HTML)
      .setUpdateType(CardService.UpdateDraftBodyType.IN_PLACE_INSERT))
    .build();
}

// ---- small utils ------------------------------------------------------

function readMessage_(e) {
  var out = { email: '', name: '', threadId: '', subject: '', messageId: '', body: '', attachmentCount: 0 };
  try {
    out.messageId = (e.gmail && e.gmail.messageId) || '';
    var token = e.gmail.accessToken;
    GmailApp.setCurrentMessageAccessToken(token);
    var msg = GmailApp.getMessageById(e.gmail.messageId);
    var from = msg.getFrom() || '';                 // "Name <email@x.com>"
    var m = from.match(/<([^>]+)>/);
    out.email = (m ? m[1] : from).trim().toLowerCase();
    out.name  = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim();
    out.subject = msg.getSubject() || '';
    out.threadId = msg.getThread().getId();
    // Body + attachments need the readonly scope.
    try { out.body = (msg.getPlainBody() || '').slice(0, 6000); } catch (b) { out.body = ''; }
    try { out.attachmentCount = msg.getAttachments({ includeInlineImages: false, includeAttachments: true }).length; } catch (a) { out.attachmentCount = 0; }
  } catch (err) { /* metadata may be unavailable; leave blanks */ }
  return out;
}

function strInput_(formInputs, name) {
  try {
    var v = formInputs[name];
    if (!v) return '';
    if (v.stringInputs && v.stringInputs.value && v.stringInputs.value.length) return String(v.stringInputs.value[0]).trim();
    return '';
  } catch (e) { return ''; }
}

function notify_(err) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('⚠️ ' + (err && err.message ? err.message : String(err))))
    .build();
}
