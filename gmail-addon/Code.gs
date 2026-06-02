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

function onGmailMessage(e) {
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
  // send-to-Maia). Pre-selected from the suggestion. Pick by name.
  var assocList = [];
  try { assocList = (apiGet_('/api/addon/associations').associations) || []; } catch (aErr) { assocList = []; }
  card.addSection(associationPickerSection_(assocList, suggest));

  // Matched ticket (if any) + quick status actions.
  if (data.matched) {
    card.addSection(matchedSection_(data.matched));
  }

  // Guided create / link form (pre-filled from the suggestion). Pull the
  // staff list so the creator can assign to anyone, not just themselves.
  var staffList = [];
  try { staffList = (apiGet_('/api/addon/staff').staff) || []; } catch (stErr) { staffList = []; }
  card.addSection(createSection_(ctx, data, suggest, staffList));

  // AI draft.
  var draftSection = CardService.newCardSection().setHeader('✨ AI reply');
  var draftBtn = CardService.newTextButton().setText('✨ Draft reply')
    .setOnClickAction(CardService.newAction().setFunctionName('draftReplyAction')
      .setParameters({ ticketId: data.matched ? String(data.matched.id) : '', threadId: ctx.threadId, email: ctx.email, subject: ctx.subject || '' }));
  draftSection.addWidget(draftBtn);
  card.addSection(draftSection);

  // Recent history for this contact.
  if (data.recent && data.recent.length) {
    card.addSection(ticketsSection_(data.recent, '', '🕘 Recent for this contact', false, ctx));
  }

  // All company open items — pick a TKT-#### to "@maia append" this email to.
  // Work orders first, then tickets, as separate sections.
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

function ticketsSection_(tickets, emptyText, headerText, collapsible, linkCtx) {
  var s = CardService.newCardSection();
  if (headerText) s.setHeader(headerText);
  if (collapsible) s.setCollapsible(true).setNumUncollapsibleWidgets(3);
  if (!tickets.length) { s.addWidget(CardService.newTextParagraph().setText(emptyText || 'Nothing here.')); return s; }
  var c = getConfig_();
  var dot = function (status) {
    return ({ open: '🟢', pending: '🟡', waiting_external: '🔵', resolved: '⚪', closed: '⚫' })[status] || '⚪';
  };
  tickets.forEach(function (t) {
    var kind = t.type === 'work_order' ? '🔧 WO' : '🎟️ Ticket';
    var line = CardService.newDecoratedText()
      .setTopLabel(dot(t.status) + '  ' + t.ticket_number + '  ·  ' + (t.status || ''))
      .setText((t.subject || '(no subject)'))
      .setBottomLabel([kind, t.association_code || '', t.priority || ''].filter(Boolean).join('  ·  '))
      .setWrapText(true)
      .setOpenLink(CardService.newOpenLink().setUrl(c.apiBase + '/admin/tickets/' + t.id));
    // When an email is open, offer a one-click "link this email here".
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
    s.addWidget(line);
  });
  return s;
}

function matchedSection_(t) {
  var s = CardService.newCardSection().setHeader('🔗 Linked ' + (t.type === 'work_order' ? 'work order' : 'ticket'));
  s.addWidget(CardService.newDecoratedText()
    .setTopLabel(t.ticket_number)
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
  return s;
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
function associationPickerSection_(assocList, suggest) {
  suggest = suggest || {};
  var selected = String(suggest.association || '').toUpperCase();
  var s = CardService.newCardSection().setHeader('🏢 Association (applies to all below)');
  // No setTitle — a floating label overlaps the value when the blank option
  // is selected. The section header above provides the label.
  var dd = CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setFieldName('association_code');
  var matched = false;
  // Placeholder first, selected only when nothing matched the suggestion.
  dd.addItem('— choose —', '', !selected);
  (assocList || []).forEach(function (a) {
    if (a && a.code) {
      var isSel = a.code.toUpperCase() === selected;
      if (isSel) matched = true;
      dd.addItem(a.code + ' · ' + (a.name || ''), a.code, isSel);
    }
  });
  if (matched) { /* a real association is selected */ }
  s.addWidget(dd);
  return s;
}

function createSection_(ctx, data, suggest, staffList) {
  suggest = suggest || {};
  staffList = staffList || [];
  var s = CardService.newCardSection().setHeader(data.matched ? '➕ Create another item' : '➕ Create ticket / work order');

  var woFirst = suggest.kind === 'work_order';   // pre-select Work order when suggested
  s.addWidget(CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Type').setFieldName('type')
    .addItem('Ticket', 'ticket', !woFirst)
    .addItem('Work order', 'work_order', woFirst));

  s.addWidget(CardService.newSelectionInput().setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle('Priority').setFieldName('priority')
    .addItem('Low', 'low', false).addItem('Normal', 'normal', true)
    .addItem('High', 'high', false).addItem('Urgent', 'urgent', false));

  // Assign to — anyone, defaulting to "Me" ('me' = the caller; a real value
  // so the floating label doesn't overlap the text).
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

  // One-click: forward THIS email to maia@ (keeps the PDF) with
  // "@maia upload this invoice #<association picked above>". Creates a
  // draft to review + Send. Needs the admin-trusted readonly+compose scopes.
  s.addWidget(CardService.newTextParagraph().setText(
    '<font color="#6b7280">Invoice? Pick the Association at the top, then:</font>'));
  s.addWidget(CardService.newTextButton().setText('📤 Send invoice to Maia')
    .setOnClickAction(CardService.newAction().setFunctionName('forwardToMaiaAction')
      .setParameters({})));
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
    s.addWidget(CardService.newTextParagraph().setText(draft.replace(/\n/g, '<br>')));
    s.addWidget(CardService.newTextParagraph().setText(
      '<i>To use it: hit Reply in Gmail, then “Insert Maia draft”. Or copy the text above.</i>'));
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
