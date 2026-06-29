// =====================================================================
// lib/portal-i18n.ts
//
// Translations for the shared resident portal (components/AssociationPortal
// + its gate, documents list, and the Mobile-App / Application popups).
//
// There is NO global i18n framework in this app — each surface ships its
// own hand-maintained dictionary (main page = app/page.tsx COPY; vendor
// pages = VendorLangBar). This is the portal's. Language is chosen via the
// ?lang= URL param (PortalLangBar switches it; the page re-renders).
//
// Server AND client components import this module and resolve with
// portalStrings(lang); only the `lang` string crosses the server→client
// boundary (so the interpolation functions below never get serialized).
// =====================================================================

export const PORTAL_LANGS = ['en', 'es', 'pt', 'fr', 'ht', 'he', 'ru'] as const
export type PortalLang = (typeof PORTAL_LANGS)[number]

export const PORTAL_LANG_LABEL: Record<PortalLang, string> = {
  en: 'English', es: 'Español', pt: 'Português', fr: 'Français', ht: 'Kreyòl', he: 'עברית', ru: 'Русский',
}

// Hebrew is the only right-to-left language in the set.
export function isRtl(lang: PortalLang): boolean {
  return lang === 'he'
}

// Coerce any incoming value (e.g. ?lang=) to a supported language; default EN.
export function normalizePortalLang(value: string | null | undefined): PortalLang {
  const v = (value ?? '').toLowerCase()
  return (PORTAL_LANGS as readonly string[]).includes(v) ? (v as PortalLang) : 'en'
}

export interface PortalStrings {
  headerSubtitle: string
  residentPortal: string

  quickActions: string
  payTitle: string; payDesc: string; payBtn: string
  achTitle: string; achDesc: string; achBtn: string
  mobileTitle: string; mobileDesc: string; mobileBtn: string
  estoppelTitle: string; estoppelDesc: string; estoppelBtn: string
  appTitle: string; appDesc: string; appBtn: string

  docsTitle: string; docsLoading: string; docsEmpty: string; docsUnavailable: string; download: string
  publicDocsTitle: string

  contactTitle: string; contactHours: string
  contactAR: string; contactMaint: string; contactCompliance: string; contactBilling: string

  // Mobile-app popup
  mobModalTitle: string; mobModalChoose: string
  mobAppStore: string; mobAppStoreSub: string; mobPlay: string; mobPlaySub: string; open: string

  // Application popup
  appModalTitle: string; appDownloadPkg: string; appFollowInstr: string
  appPkgLoading: string; appPkgEmpty: string; appPkgLabel: string
  appReviewThen: string; appBgTitle: string; appBgDesc: string; appBgBtn: string

  // Gate
  loading: string; signOut: string
  personaOwner: string; personaBoard: string; personaTenant: string; personaStaff: string; personaOnsite: string
  previewPrefix: string
  previewVisitor: string; previewOwner: string; previewBoard: string; previewOnsite: string
  prevTitle: string; prevBody: (name: string, assoc: string, ended: string) => string
  prevError: string; contactPmi: string; prevTryDifferent: string
  notFoundTitle: string; notFoundBody: (id: string, assoc: string) => string; notFoundNew: string; notFoundTryAgain: string
  wrongTitle: string; wrongBody: (name: string, sessionAssoc: string, assoc: string) => string; wrongSwitch: string; wrongBack: string
  loginInstr: string; loginLabel: string; loginPlaceholder: string; loginLookingUp: string; continueBtn: string
  networkErr: string; notResident: string; visitMain: string

  publicIntro: string; residentLoginCta: string; residentLoginHide: string
  siteLabel: string; publicMoreInfo: string
  langLabel: string
  openTicket: string
}

const en: PortalStrings = {
  headerSubtitle: 'Association Portal',
  residentPortal: 'Resident Portal',
  quickActions: 'Quick Actions',
  payTitle: 'Pay HOA Fees', payDesc: 'Access your balance and make a payment', payBtn: 'Open Portal',
  achTitle: 'Set up Autopay (ACH) — FREE', achDesc: 'Pay automatically from your bank · drafted on the 1st · sign online in 2 minutes', achBtn: 'Set up',
  mobileTitle: 'PMI Mobile App', mobileDesc: 'Pay fees · Submit requests · Manage your account on the go', mobileBtn: 'Download',
  estoppelTitle: 'Estoppel Request – Condocerts', estoppelDesc: 'Required for property sale or refinancing · 5–7 business days', estoppelBtn: 'Submit',
  appTitle: 'Tenant / Buyer Application', appDesc: 'Board approval required · Background and credit check included', appBtn: 'Apply Now',
  publicDocsTitle: 'Public Documents',
  docsTitle: 'Association Documents', docsLoading: 'Loading documents…',
  docsEmpty: 'No documents have been published for this association yet. They will appear here as your management team uploads them.',
  docsUnavailable: 'Documents are temporarily unavailable.', download: 'Download',
  contactTitle: 'Contact PMI Top Florida Properties', contactHours: 'Monday–Thursday 10AM–5PM · Friday 10AM–3PM',
  contactAR: 'Accounts Receivable', contactMaint: 'Maintenance & Service', contactCompliance: 'Compliance & Support', contactBilling: 'Vendor Billing',
  mobModalTitle: 'Get the PMI Mobile App', mobModalChoose: 'Choose your device',
  mobAppStore: 'App Store', mobAppStoreSub: 'iPhone & iPad', mobPlay: 'Google Play', mobPlaySub: 'Android', open: 'Open',
  appModalTitle: 'Tenant / Buyer Application',
  appDownloadPkg: 'Don’t forget to download the application package', appFollowInstr: 'and follow the instructions inside before you start.',
  appPkgLoading: 'Loading application package…',
  appPkgEmpty: 'The application package isn’t posted for this association yet. Please contact your management team, or check the Association Documents section below.',
  appPkgLabel: 'Application Package',
  appReviewThen: 'Once you’ve reviewed the package, click below to run your background check:',
  appBgTitle: 'Run Background & Credit Check', appBgDesc: 'Board approval required · Opens the secure screening site', appBgBtn: 'Start',
  loading: 'Loading…', signOut: 'Sign out',
  personaOwner: 'Unit Owner', personaBoard: 'Board Member', personaTenant: 'Tenant', personaStaff: 'PMI Staff', personaOnsite: 'Onsite Manager',
  previewPrefix: 'Staff preview — viewing as',
  previewVisitor: 'a public visitor', previewOwner: 'a logged-in unit owner', previewBoard: 'a board member', previewOnsite: 'an onsite (non-staff) manager',
  prevTitle: 'Previous Resident',
  prevBody: (n, a, e) => `${n}, our records show your membership at ${a} ended${e}.`,
  prevError: 'If you believe this is an error, please contact PMI directly.', contactPmi: 'Contact PMI →', prevTryDifferent: 'Try a different account',
  notFoundTitle: 'Not Found',
  notFoundBody: (id, a) => `We couldn’t find an account matching ${id} in the ${a} database.`,
  notFoundNew: 'New resident? Your record may not be set up yet. Contact PMI to get started.', notFoundTryAgain: '← Try again',
  wrongTitle: 'Different Association',
  wrongBody: (n, sa, a) => `You’re signed in as ${n} for ${sa}. This portal is for ${a}.`,
  wrongSwitch: 'Sign out and switch', wrongBack: 'Back to main portal',
  loginInstr: 'Enter your email or phone number to access your documents and account information.',
  loginLabel: 'Email or Phone Number', loginPlaceholder: 'your@email.com or (305) 555-0100', loginLookingUp: 'Looking up…', continueBtn: 'Continue →',
  networkErr: 'Network error. Please try again.', notResident: 'Not a resident?', visitMain: 'Visit main site',
  publicIntro: 'Public documents and information for this association — no login needed.', residentLoginCta: 'Residents — log in to your account', residentLoginHide: 'Hide',
  siteLabel: 'Association Site', publicMoreInfo: 'Owners, residents, and board members can log in for account details and more.',
  langLabel: 'Language',
  openTicket: 'Open a ticket',
}

const es: PortalStrings = {
  headerSubtitle: 'Portal de la Asociación',
  residentPortal: 'Portal del Residente',
  quickActions: 'Acciones Rápidas',
  payTitle: 'Pagar Cuotas HOA', payDesc: 'Consulte su saldo y realice un pago', payBtn: 'Abrir Portal',
  achTitle: 'Configurar Pago Automático (ACH) — GRATIS', achDesc: 'Pague automáticamente desde su banco · el día 1 · firme en línea en 2 minutos', achBtn: 'Configurar',
  mobileTitle: 'App Móvil PMI', mobileDesc: 'Pague cuotas · Envíe solicitudes · Administre su cuenta sobre la marcha', mobileBtn: 'Descargar',
  estoppelTitle: 'Solicitud de Estoppel – Condocerts', estoppelDesc: 'Requerido para venta o refinanciamiento · 5–7 días hábiles', estoppelBtn: 'Enviar',
  appTitle: 'Solicitud de Inquilino / Comprador', appDesc: 'Requiere aprobación de la junta · Incluye verificación de antecedentes y crédito', appBtn: 'Solicitar',
  publicDocsTitle: 'Documentos Públicos',
  docsTitle: 'Documentos de la Asociación', docsLoading: 'Cargando documentos…',
  docsEmpty: 'Aún no se han publicado documentos para esta asociación. Aparecerán aquí a medida que su equipo de administración los cargue.',
  docsUnavailable: 'Los documentos no están disponibles temporalmente.', download: 'Descargar',
  contactTitle: 'Contacte a PMI Top Florida Properties', contactHours: 'Lunes–Jueves 10AM–5PM · Viernes 10AM–3PM',
  contactAR: 'Cuentas por Cobrar', contactMaint: 'Mantenimiento y Servicio', contactCompliance: 'Cumplimiento y Soporte', contactBilling: 'Facturación de Proveedores',
  mobModalTitle: 'Obtenga la App Móvil PMI', mobModalChoose: 'Elija su dispositivo',
  mobAppStore: 'App Store', mobAppStoreSub: 'iPhone y iPad', mobPlay: 'Google Play', mobPlaySub: 'Android', open: 'Abrir',
  appModalTitle: 'Solicitud de Inquilino / Comprador',
  appDownloadPkg: 'No olvide descargar el paquete de solicitud', appFollowInstr: 'y siga las instrucciones que contiene antes de comenzar.',
  appPkgLoading: 'Cargando el paquete de solicitud…',
  appPkgEmpty: 'El paquete de solicitud aún no está publicado para esta asociación. Comuníquese con su equipo de administración o consulte la sección Documentos de la Asociación más abajo.',
  appPkgLabel: 'Paquete de Solicitud',
  appReviewThen: 'Una vez que haya revisado el paquete, haga clic abajo para realizar su verificación de antecedentes:',
  appBgTitle: 'Verificación de Antecedentes y Crédito', appBgDesc: 'Requiere aprobación de la junta · Abre el sitio seguro de evaluación', appBgBtn: 'Comenzar',
  loading: 'Cargando…', signOut: 'Cerrar sesión',
  personaOwner: 'Propietario', personaBoard: 'Miembro de la Junta', personaTenant: 'Inquilino', personaStaff: 'Personal PMI', personaOnsite: 'Administrador en Sitio',
  previewPrefix: 'Vista previa del personal — viendo como',
  previewVisitor: 'un visitante público', previewOwner: 'un propietario con sesión iniciada', previewBoard: 'un miembro de la junta', previewOnsite: 'un administrador en sitio (no del personal)',
  prevTitle: 'Residente Anterior',
  prevBody: (n, a, e) => `${n}, nuestros registros muestran que su membresía en ${a} finalizó${e}.`,
  prevError: 'Si cree que esto es un error, comuníquese directamente con PMI.', contactPmi: 'Contactar a PMI →', prevTryDifferent: 'Probar con otra cuenta',
  notFoundTitle: 'No Encontrado',
  notFoundBody: (id, a) => `No pudimos encontrar una cuenta que coincida con ${id} en la base de datos de ${a}.`,
  notFoundNew: '¿Nuevo residente? Es posible que su registro aún no esté configurado. Comuníquese con PMI para comenzar.', notFoundTryAgain: '← Intentar de nuevo',
  wrongTitle: 'Asociación Diferente',
  wrongBody: (n, sa, a) => `Ha iniciado sesión como ${n} para ${sa}. Este portal es para ${a}.`,
  wrongSwitch: 'Cerrar sesión y cambiar', wrongBack: 'Volver al portal principal',
  loginInstr: 'Ingrese su correo electrónico o número de teléfono para acceder a sus documentos e información de cuenta.',
  loginLabel: 'Correo o Número de Teléfono', loginPlaceholder: 'su@correo.com o (305) 555-0100', loginLookingUp: 'Buscando…', continueBtn: 'Continuar →',
  networkErr: 'Error de red. Inténtelo de nuevo.', notResident: '¿No es residente?', visitMain: 'Visitar sitio principal',
  publicIntro: 'Documentos e información pública de esta asociación — sin iniciar sesión.', residentLoginCta: 'Residentes — inicie sesión en su cuenta', residentLoginHide: 'Ocultar',
  siteLabel: 'Sitio de la Asociación', publicMoreInfo: 'Propietarios, residentes y miembros de la junta pueden iniciar sesión para ver los detalles de su cuenta y más.',
  langLabel: 'Idioma',
  openTicket: 'Abrir un ticket',
}

const pt: PortalStrings = {
  headerSubtitle: 'Portal da Associação',
  residentPortal: 'Portal do Residente',
  quickActions: 'Ações Rápidas',
  payTitle: 'Pagar Taxas HOA', payDesc: 'Acesse seu saldo e faça um pagamento', payBtn: 'Abrir Portal',
  achTitle: 'Configurar Débito Automático (ACH) — GRÁTIS', achDesc: 'Pague automaticamente da sua conta · no dia 1 · assine online em 2 minutos', achBtn: 'Configurar',
  mobileTitle: 'Aplicativo PMI', mobileDesc: 'Pague taxas · Envie solicitações · Gerencie sua conta em qualquer lugar', mobileBtn: 'Baixar',
  estoppelTitle: 'Solicitação de Estoppel – Condocerts', estoppelDesc: 'Necessário para venda ou refinanciamento · 5–7 dias úteis', estoppelBtn: 'Enviar',
  appTitle: 'Solicitação de Inquilino / Comprador', appDesc: 'Aprovação do conselho necessária · Inclui verificação de antecedentes e crédito', appBtn: 'Inscrever-se',
  publicDocsTitle: 'Documentos Públicos',
  docsTitle: 'Documentos da Associação', docsLoading: 'Carregando documentos…',
  docsEmpty: 'Nenhum documento foi publicado para esta associação ainda. Eles aparecerão aqui à medida que sua equipe de administração os carregar.',
  docsUnavailable: 'Os documentos estão temporariamente indisponíveis.', download: 'Baixar',
  contactTitle: 'Contate a PMI Top Florida Properties', contactHours: 'Segunda–Quinta 10h–17h · Sexta 10h–15h',
  contactAR: 'Contas a Receber', contactMaint: 'Manutenção e Serviço', contactCompliance: 'Conformidade e Suporte', contactBilling: 'Faturamento de Fornecedores',
  mobModalTitle: 'Obtenha o Aplicativo PMI', mobModalChoose: 'Escolha seu dispositivo',
  mobAppStore: 'App Store', mobAppStoreSub: 'iPhone e iPad', mobPlay: 'Google Play', mobPlaySub: 'Android', open: 'Abrir',
  appModalTitle: 'Solicitação de Inquilino / Comprador',
  appDownloadPkg: 'Não se esqueça de baixar o pacote de inscrição', appFollowInstr: 'e siga as instruções incluídas antes de começar.',
  appPkgLoading: 'Carregando o pacote de inscrição…',
  appPkgEmpty: 'O pacote de inscrição ainda não foi publicado para esta associação. Entre em contato com sua equipe de administração ou consulte a seção Documentos da Associação abaixo.',
  appPkgLabel: 'Pacote de Inscrição',
  appReviewThen: 'Depois de revisar o pacote, clique abaixo para fazer sua verificação de antecedentes:',
  appBgTitle: 'Verificação de Antecedentes e Crédito', appBgDesc: 'Aprovação do conselho necessária · Abre o site seguro de triagem', appBgBtn: 'Iniciar',
  loading: 'Carregando…', signOut: 'Sair',
  personaOwner: 'Proprietário', personaBoard: 'Membro do Conselho', personaTenant: 'Inquilino', personaStaff: 'Equipe PMI', personaOnsite: 'Gerente no Local',
  previewPrefix: 'Visualização da equipe — vendo como',
  previewVisitor: 'um visitante público', previewOwner: 'um proprietário conectado', previewBoard: 'um membro do conselho', previewOnsite: 'um gerente no local (não da equipe)',
  prevTitle: 'Residente Anterior',
  prevBody: (n, a, e) => `${n}, nossos registros mostram que sua associação em ${a} terminou${e}.`,
  prevError: 'Se você acredita que isto é um erro, entre em contato diretamente com a PMI.', contactPmi: 'Contatar PMI →', prevTryDifferent: 'Tentar outra conta',
  notFoundTitle: 'Não Encontrado',
  notFoundBody: (id, a) => `Não encontramos uma conta correspondente a ${id} no banco de dados de ${a}.`,
  notFoundNew: 'Novo residente? Seu cadastro pode ainda não estar configurado. Entre em contato com a PMI para começar.', notFoundTryAgain: '← Tentar novamente',
  wrongTitle: 'Associação Diferente',
  wrongBody: (n, sa, a) => `Você está conectado como ${n} para ${sa}. Este portal é para ${a}.`,
  wrongSwitch: 'Sair e trocar', wrongBack: 'Voltar ao portal principal',
  loginInstr: 'Digite seu e-mail ou número de telefone para acessar seus documentos e informações da conta.',
  loginLabel: 'E-mail ou Número de Telefone', loginPlaceholder: 'seu@email.com ou (305) 555-0100', loginLookingUp: 'Buscando…', continueBtn: 'Continuar →',
  networkErr: 'Erro de rede. Tente novamente.', notResident: 'Não é residente?', visitMain: 'Visitar site principal',
  publicIntro: 'Documentos e informações públicas desta associação — sem login.', residentLoginCta: 'Moradores — entre na sua conta', residentLoginHide: 'Ocultar',
  siteLabel: 'Site da Associação', publicMoreInfo: 'Proprietários, moradores e membros do conselho podem entrar para ver os detalhes da conta e mais.',
  langLabel: 'Idioma',
  openTicket: 'Abrir um chamado',
}

const fr: PortalStrings = {
  headerSubtitle: 'Portail de l’Association',
  residentPortal: 'Portail du Résident',
  quickActions: 'Actions Rapides',
  payTitle: 'Payer les Frais HOA', payDesc: 'Consultez votre solde et effectuez un paiement', payBtn: 'Ouvrir le Portail',
  achTitle: 'Configurer le Prélèvement (ACH) — GRATUIT', achDesc: 'Payez automatiquement depuis votre banque · le 1er · signez en ligne en 2 minutes', achBtn: 'Configurer',
  mobileTitle: 'Application PMI', mobileDesc: 'Payez les frais · Envoyez des demandes · Gérez votre compte en déplacement', mobileBtn: 'Télécharger',
  estoppelTitle: 'Demande d’Estoppel – Condocerts', estoppelDesc: 'Requis pour la vente ou le refinancement · 5–7 jours ouvrables', estoppelBtn: 'Envoyer',
  appTitle: 'Demande de Locataire / Acheteur', appDesc: 'Approbation du conseil requise · Vérification des antécédents et du crédit incluse', appBtn: 'Postuler',
  publicDocsTitle: 'Documents Publics',
  docsTitle: 'Documents de l’Association', docsLoading: 'Chargement des documents…',
  docsEmpty: 'Aucun document n’a encore été publié pour cette association. Ils apparaîtront ici au fur et à mesure que votre équipe de gestion les téléchargera.',
  docsUnavailable: 'Les documents sont temporairement indisponibles.', download: 'Télécharger',
  contactTitle: 'Contactez PMI Top Florida Properties', contactHours: 'Lundi–Jeudi 10h–17h · Vendredi 10h–15h',
  contactAR: 'Comptes Clients', contactMaint: 'Entretien et Service', contactCompliance: 'Conformité et Assistance', contactBilling: 'Facturation Fournisseurs',
  mobModalTitle: 'Obtenez l’Application PMI', mobModalChoose: 'Choisissez votre appareil',
  mobAppStore: 'App Store', mobAppStoreSub: 'iPhone et iPad', mobPlay: 'Google Play', mobPlaySub: 'Android', open: 'Ouvrir',
  appModalTitle: 'Demande de Locataire / Acheteur',
  appDownloadPkg: 'N’oubliez pas de télécharger le dossier de candidature', appFollowInstr: 'et suivez les instructions à l’intérieur avant de commencer.',
  appPkgLoading: 'Chargement du dossier de candidature…',
  appPkgEmpty: 'Le dossier de candidature n’est pas encore publié pour cette association. Veuillez contacter votre équipe de gestion ou consulter la section Documents de l’Association ci-dessous.',
  appPkgLabel: 'Dossier de Candidature',
  appReviewThen: 'Une fois le dossier examiné, cliquez ci-dessous pour lancer votre vérification des antécédents :',
  appBgTitle: 'Vérification des Antécédents et du Crédit', appBgDesc: 'Approbation du conseil requise · Ouvre le site sécurisé de vérification', appBgBtn: 'Commencer',
  loading: 'Chargement…', signOut: 'Se déconnecter',
  personaOwner: 'Propriétaire', personaBoard: 'Membre du Conseil', personaTenant: 'Locataire', personaStaff: 'Personnel PMI', personaOnsite: 'Gestionnaire sur Site',
  previewPrefix: 'Aperçu du personnel — vue en tant que',
  previewVisitor: 'un visiteur public', previewOwner: 'un propriétaire connecté', previewBoard: 'un membre du conseil', previewOnsite: 'un gestionnaire sur site (hors personnel)',
  prevTitle: 'Ancien Résident',
  prevBody: (n, a, e) => `${n}, nos dossiers indiquent que votre adhésion à ${a} a pris fin${e}.`,
  prevError: 'Si vous pensez qu’il s’agit d’une erreur, veuillez contacter PMI directement.', contactPmi: 'Contacter PMI →', prevTryDifferent: 'Essayer un autre compte',
  notFoundTitle: 'Introuvable',
  notFoundBody: (id, a) => `Nous n’avons pas trouvé de compte correspondant à ${id} dans la base de données de ${a}.`,
  notFoundNew: 'Nouveau résident ? Votre dossier n’est peut-être pas encore configuré. Contactez PMI pour commencer.', notFoundTryAgain: '← Réessayer',
  wrongTitle: 'Association Différente',
  wrongBody: (n, sa, a) => `Vous êtes connecté en tant que ${n} pour ${sa}. Ce portail est pour ${a}.`,
  wrongSwitch: 'Se déconnecter et changer', wrongBack: 'Retour au portail principal',
  loginInstr: 'Saisissez votre e-mail ou votre numéro de téléphone pour accéder à vos documents et aux informations de votre compte.',
  loginLabel: 'E-mail ou Numéro de Téléphone', loginPlaceholder: 'votre@email.com ou (305) 555-0100', loginLookingUp: 'Recherche…', continueBtn: 'Continuer →',
  networkErr: 'Erreur réseau. Veuillez réessayer.', notResident: 'Pas un résident ?', visitMain: 'Visiter le site principal',
  publicIntro: 'Documents et informations publics de cette association — sans connexion.', residentLoginCta: 'Résidents — connectez-vous à votre compte', residentLoginHide: 'Masquer',
  siteLabel: 'Site de l’Association', publicMoreInfo: 'Les propriétaires, résidents et membres du conseil peuvent se connecter pour accéder à leur compte et plus.',
  langLabel: 'Langue',
  openTicket: 'Ouvrir un ticket',
}

const ht: PortalStrings = {
  headerSubtitle: 'Pòtal Asosyasyon an',
  residentPortal: 'Pòtal Rezidan an',
  quickActions: 'Aksyon Rapid',
  payTitle: 'Peye Frè HOA', payDesc: 'Gade balans ou epi fè yon peman', payBtn: 'Louvri Pòtal',
  achTitle: 'Konfigire Otopèman (ACH) — GRATIS', achDesc: 'Peye otomatikman nan bank ou · nan dat 1 · siyen anliy nan 2 minit', achBtn: 'Konfigire',
  mobileTitle: 'Aplikasyon Mobil PMI', mobileDesc: 'Peye frè · Voye demann · Jere kont ou kote ou ye', mobileBtn: 'Telechaje',
  estoppelTitle: 'Demann Estoppel – Condocerts', estoppelDesc: 'Obligatwa pou vann oswa refinanse · 5–7 jou ouvrab', estoppelBtn: 'Voye',
  appTitle: 'Aplikasyon Lokatè / Achtè', appDesc: 'Apwobasyon konsèy la nesesè · Verifikasyon background ak kredi enkli', appBtn: 'Aplike',
  publicDocsTitle: 'Dokiman Piblik',
  docsTitle: 'Dokiman Asosyasyon an', docsLoading: 'Y ap chaje dokiman yo…',
  docsEmpty: 'Pa gen okenn dokiman ki pibliye pou asosyasyon sa a ankò. Yo pral parèt isit la lè ekip jesyon ou an telechaje yo.',
  docsUnavailable: 'Dokiman yo pa disponib pou kounye a.', download: 'Telechaje',
  contactTitle: 'Kontakte PMI Top Florida Properties', contactHours: 'Lendi–Jedi 10AM–5PM · Vandredi 10AM–3PM',
  contactAR: 'Kont Resevwa', contactMaint: 'Antretyen ak Sèvis', contactCompliance: 'Konfòmite ak Sipò', contactBilling: 'Faktirasyon Founisè',
  mobModalTitle: 'Jwenn Aplikasyon Mobil PMI', mobModalChoose: 'Chwazi aparèy ou',
  mobAppStore: 'App Store', mobAppStoreSub: 'iPhone ak iPad', mobPlay: 'Google Play', mobPlaySub: 'Android', open: 'Louvri',
  appModalTitle: 'Aplikasyon Lokatè / Achtè',
  appDownloadPkg: 'Pa bliye telechaje pakè aplikasyon an', appFollowInstr: 'epi swiv enstriksyon ki ladan l yo anvan ou kòmanse.',
  appPkgLoading: 'Y ap chaje pakè aplikasyon an…',
  appPkgEmpty: 'Pakè aplikasyon an poko pibliye pou asosyasyon sa a. Tanpri kontakte ekip jesyon ou an, oswa gade seksyon Dokiman Asosyasyon an pi ba a.',
  appPkgLabel: 'Pakè Aplikasyon',
  appReviewThen: 'Lè ou fin gade pakè a, klike anba a pou fè verifikasyon background ou:',
  appBgTitle: 'Fè Verifikasyon Background ak Kredi', appBgDesc: 'Apwobasyon konsèy la nesesè · Louvri sit sekirize verifikasyon an', appBgBtn: 'Kòmanse',
  loading: 'Y ap chaje…', signOut: 'Dekonekte',
  personaOwner: 'Pwopriyetè', personaBoard: 'Manm Konsèy', personaTenant: 'Lokatè', personaStaff: 'Anplwaye PMI', personaOnsite: 'Jeran sou Plas',
  previewPrefix: 'Apèsi anplwaye — w ap gade kòm',
  previewVisitor: 'yon vizitè piblik', previewOwner: 'yon pwopriyetè ki konekte', previewBoard: 'yon manm konsèy', previewOnsite: 'yon jeran sou plas (ki pa anplwaye)',
  prevTitle: 'Ansyen Rezidan',
  prevBody: (n, a, e) => `${n}, dosye nou yo montre afilyasyon ou nan ${a} te fini${e}.`,
  prevError: 'Si ou kwè sa a se yon erè, tanpri kontakte PMI dirèkteman.', contactPmi: 'Kontakte PMI →', prevTryDifferent: 'Eseye yon lòt kont',
  notFoundTitle: 'Pa Jwenn',
  notFoundBody: (id, a) => `Nou pa t kapab jwenn yon kont ki koresponn ak ${id} nan baz done ${a} a.`,
  notFoundNew: 'Nouvo rezidan? Dosye ou ka poko konfigire. Kontakte PMI pou kòmanse.', notFoundTryAgain: '← Eseye ankò',
  wrongTitle: 'Lòt Asosyasyon',
  wrongBody: (n, sa, a) => `Ou konekte kòm ${n} pou ${sa}. Pòtal sa a se pou ${a}.`,
  wrongSwitch: 'Dekonekte epi chanje', wrongBack: 'Retounen nan pòtal prensipal la',
  loginInstr: 'Antre imèl ou oswa nimewo telefòn ou pou jwenn aksè a dokiman ak enfòmasyon kont ou.',
  loginLabel: 'Imèl oswa Nimewo Telefòn', loginPlaceholder: 'imel@ou.com oswa (305) 555-0100', loginLookingUp: 'N ap chèche…', continueBtn: 'Kontinye →',
  networkErr: 'Erè rezo. Tanpri eseye ankò.', notResident: 'Ou pa yon rezidan?', visitMain: 'Vizite sit prensipal la',
  publicIntro: 'Dokiman ak enfòmasyon piblik asosyasyon an — san koneksyon.', residentLoginCta: 'Rezidan — konekte nan kont ou', residentLoginHide: 'Kache',
  siteLabel: 'Sit Asosyasyon an', publicMoreInfo: 'Pwopriyetè, rezidan, ak manm konsèy yo ka konekte pou wè detay kont yo ak plis.',
  langLabel: 'Lang',
  openTicket: 'Louvri yon tikè',
}

const he: PortalStrings = {
  headerSubtitle: 'פורטל האיגוד',
  residentPortal: 'פורטל הדיירים',
  quickActions: 'פעולות מהירות',
  payTitle: 'תשלום דמי HOA', payDesc: 'צפו ביתרה ובצעו תשלום', payBtn: 'פתח פורטל',
  achTitle: 'הגדרת תשלום אוטומטי (ACH) — חינם', achDesc: 'תשלום אוטומטי מחשבון הבנק · ב-1 לחודש · חתימה מקוונת ב-2 דקות', achBtn: 'הגדרה',
  mobileTitle: 'אפליקציית PMI', mobileDesc: 'שלמו דמי חבר · שלחו בקשות · נהלו את החשבון בכל מקום', mobileBtn: 'הורדה',
  estoppelTitle: 'בקשת Estoppel – Condocerts', estoppelDesc: 'נדרש למכירה או מימון מחדש · 5–7 ימי עסקים', estoppelBtn: 'שליחה',
  appTitle: 'בקשת שוכר / קונה', appDesc: 'נדרש אישור הוועד · כולל בדיקת רקע ואשראי', appBtn: 'הגשת בקשה',
  publicDocsTitle: 'מסמכים ציבוריים',
  docsTitle: 'מסמכי האיגוד', docsLoading: 'טוען מסמכים…',
  docsEmpty: 'עדיין לא פורסמו מסמכים עבור איגוד זה. הם יופיעו כאן ככל שצוות הניהול יעלה אותם.',
  docsUnavailable: 'המסמכים אינם זמינים כרגע.', download: 'הורדה',
  contactTitle: 'צרו קשר עם PMI Top Florida Properties', contactHours: 'שני–חמישי 10:00–17:00 · שישי 10:00–15:00',
  contactAR: 'חשבונות לקבל', contactMaint: 'תחזוקה ושירות', contactCompliance: 'תאימות ותמיכה', contactBilling: 'חיוב ספקים',
  mobModalTitle: 'הורידו את אפליקציית PMI', mobModalChoose: 'בחרו את המכשיר שלכם',
  mobAppStore: 'App Store', mobAppStoreSub: 'אייפון ואייפד', mobPlay: 'Google Play', mobPlaySub: 'אנדרואיד', open: 'פתיחה',
  appModalTitle: 'בקשת שוכר / קונה',
  appDownloadPkg: 'אל תשכחו להוריד את חבילת הבקשה', appFollowInstr: 'ולעקוב אחר ההוראות שבתוכה לפני שתתחילו.',
  appPkgLoading: 'טוען את חבילת הבקשה…',
  appPkgEmpty: 'חבילת הבקשה עדיין לא פורסמה עבור איגוד זה. אנא צרו קשר עם צוות הניהול, או עיינו בקטע מסמכי האיגוד למטה.',
  appPkgLabel: 'חבילת בקשה',
  appReviewThen: 'לאחר שעיינתם בחבילה, לחצו למטה כדי לבצע את בדיקת הרקע שלכם:',
  appBgTitle: 'בדיקת רקע ואשראי', appBgDesc: 'נדרש אישור הוועד · נפתח אתר הסינון המאובטח', appBgBtn: 'התחלה',
  loading: 'טוען…', signOut: 'התנתקות',
  personaOwner: 'בעל יחידה', personaBoard: 'חבר ועד', personaTenant: 'שוכר', personaStaff: 'צוות PMI', personaOnsite: 'מנהל באתר',
  previewPrefix: 'תצוגת צוות — צפייה בתור',
  previewVisitor: 'מבקר ציבורי', previewOwner: 'בעל יחידה מחובר', previewBoard: 'חבר ועד', previewOnsite: 'מנהל באתר (לא מהצוות)',
  prevTitle: 'דייר קודם',
  prevBody: (n, a, e) => `${n}, הרישומים שלנו מראים שחברותך ב-${a} הסתיימה${e}.`,
  prevError: 'אם לדעתך מדובר בטעות, אנא צרו קשר ישירות עם PMI.', contactPmi: 'צרו קשר עם PMI →', prevTryDifferent: 'נסו חשבון אחר',
  notFoundTitle: 'לא נמצא',
  notFoundBody: (id, a) => `לא הצלחנו למצוא חשבון התואם ל-${id} במאגר של ${a}.`,
  notFoundNew: 'דייר חדש? ייתכן שהרישום שלך עדיין לא הוגדר. צרו קשר עם PMI כדי להתחיל.', notFoundTryAgain: '← נסו שוב',
  wrongTitle: 'איגוד אחר',
  wrongBody: (n, sa, a) => `אתה מחובר בתור ${n} עבור ${sa}. פורטל זה מיועד ל-${a}.`,
  wrongSwitch: 'התנתקו והחליפו', wrongBack: 'חזרה לפורטל הראשי',
  loginInstr: 'הזינו את כתובת האימייל או מספר הטלפון שלכם כדי לגשת למסמכים ולפרטי החשבון.',
  loginLabel: 'אימייל או מספר טלפון', loginPlaceholder: 'your@email.com או (305) 555-0100', loginLookingUp: 'מחפש…', continueBtn: 'המשך →',
  networkErr: 'שגיאת רשת. אנא נסו שוב.', notResident: 'לא דייר?', visitMain: 'בקרו באתר הראשי',
  publicIntro: 'מסמכים ומידע ציבורי של האיגוד — ללא התחברות.', residentLoginCta: 'תושבים — היכנסו לחשבון שלכם', residentLoginHide: 'הסתר',
  siteLabel: 'אתר האיגוד', publicMoreInfo: 'בעלים, דיירים וחברי ועד יכולים להתחבר לפרטי החשבון ועוד.',
  langLabel: 'שפה',
  openTicket: 'פתחו פנייה',
}

const ru: PortalStrings = {
  headerSubtitle: 'Портал ассоциации',
  residentPortal: 'Портал жильца',
  quickActions: 'Быстрые действия',
  payTitle: 'Оплата взносов HOA', payDesc: 'Просмотр баланса и оплата', payBtn: 'Открыть портал',
  achTitle: 'Настроить автоплатёж (ACH) — БЕСПЛАТНО', achDesc: 'Автосписание из вашего банка · 1-го числа · подпишите онлайн за 2 минуты', achBtn: 'Настроить',
  mobileTitle: 'Мобильное приложение PMI', mobileDesc: 'Оплата взносов · Подача заявок · Управление счётом на ходу', mobileBtn: 'Скачать',
  estoppelTitle: 'Запрос Estoppel – Condocerts', estoppelDesc: 'Требуется при продаже или рефинансировании · 5–7 рабочих дней', estoppelBtn: 'Отправить',
  appTitle: 'Заявка арендатора / покупателя', appDesc: 'Требуется одобрение правления · Включает проверку биографии и кредита', appBtn: 'Подать заявку',
  publicDocsTitle: 'Публичные документы',
  docsTitle: 'Документы ассоциации', docsLoading: 'Загрузка документов…',
  docsEmpty: 'Для этой ассоциации ещё не опубликованы документы. Они появятся здесь по мере загрузки вашей управляющей командой.',
  docsUnavailable: 'Документы временно недоступны.', download: 'Скачать',
  contactTitle: 'Свяжитесь с PMI Top Florida Properties', contactHours: 'Понедельник–Четверг 10:00–17:00 · Пятница 10:00–15:00',
  contactAR: 'Дебиторская задолженность', contactMaint: 'Обслуживание и сервис', contactCompliance: 'Соответствие и поддержка', contactBilling: 'Выставление счетов поставщикам',
  mobModalTitle: 'Установите приложение PMI', mobModalChoose: 'Выберите ваше устройство',
  mobAppStore: 'App Store', mobAppStoreSub: 'iPhone и iPad', mobPlay: 'Google Play', mobPlaySub: 'Android', open: 'Открыть',
  appModalTitle: 'Заявка арендатора / покупателя',
  appDownloadPkg: 'Не забудьте скачать пакет заявки', appFollowInstr: 'и следуйте инструкциям внутри, прежде чем начать.',
  appPkgLoading: 'Загрузка пакета заявки…',
  appPkgEmpty: 'Пакет заявки для этой ассоциации ещё не опубликован. Пожалуйста, свяжитесь с вашей управляющей командой или см. раздел «Документы ассоциации» ниже.',
  appPkgLabel: 'Пакет заявки',
  appReviewThen: 'После просмотра пакета нажмите ниже, чтобы пройти проверку биографии:',
  appBgTitle: 'Проверка биографии и кредита', appBgDesc: 'Требуется одобрение правления · Откроется защищённый сайт проверки', appBgBtn: 'Начать',
  loading: 'Загрузка…', signOut: 'Выйти',
  personaOwner: 'Владелец', personaBoard: 'Член правления', personaTenant: 'Арендатор', personaStaff: 'Сотрудник PMI', personaOnsite: 'Управляющий на месте',
  previewPrefix: 'Предпросмотр для персонала — просмотр как',
  previewVisitor: 'публичный посетитель', previewOwner: 'вошедший владелец', previewBoard: 'член правления', previewOnsite: 'управляющий на месте (не сотрудник)',
  prevTitle: 'Бывший житель',
  prevBody: (n, a, e) => `${n}, по нашим данным ваше членство в ${a} закончилось${e}.`,
  prevError: 'Если вы считаете это ошибкой, свяжитесь с PMI напрямую.', contactPmi: 'Связаться с PMI →', prevTryDifferent: 'Попробовать другой аккаунт',
  notFoundTitle: 'Не найдено',
  notFoundBody: (id, a) => `Не удалось найти учётную запись, соответствующую ${id}, в базе данных ${a}.`,
  notFoundNew: 'Новый житель? Ваша запись, возможно, ещё не настроена. Свяжитесь с PMI, чтобы начать.', notFoundTryAgain: '← Попробовать снова',
  wrongTitle: 'Другая ассоциация',
  wrongBody: (n, sa, a) => `Вы вошли как ${n} для ${sa}. Этот портал предназначен для ${a}.`,
  wrongSwitch: 'Выйти и сменить', wrongBack: 'Вернуться на главный портал',
  loginInstr: 'Введите ваш адрес электронной почты или номер телефона, чтобы получить доступ к документам и информации об учётной записи.',
  loginLabel: 'Эл. почта или номер телефона', loginPlaceholder: 'your@email.com или (305) 555-0100', loginLookingUp: 'Поиск…', continueBtn: 'Продолжить →',
  networkErr: 'Ошибка сети. Пожалуйста, попробуйте снова.', notResident: 'Не житель?', visitMain: 'Перейти на главный сайт',
  publicIntro: 'Публичные документы и информация ассоциации — без входа.', residentLoginCta: 'Жители — войдите в свой аккаунт', residentLoginHide: 'Скрыть',
  siteLabel: 'Сайт ассоциации', publicMoreInfo: 'Владельцы, жители и члены правления могут войти, чтобы увидеть данные аккаунта и больше.',
  langLabel: 'Язык',
  openTicket: 'Создать обращение',
}

const COPY: Record<PortalLang, PortalStrings> = { en, es, pt, fr, ht, he, ru }

export function portalStrings(lang: PortalLang): PortalStrings {
  return COPY[lang] ?? en
}
