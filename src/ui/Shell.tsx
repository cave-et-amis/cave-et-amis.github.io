/** Cadre de l'application connectée : barre du haut, onglets (téléphone) ou navigation latérale (ordinateur), fenêtres globales. */
import { createContext, Suspense, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, BookOpen, CalendarHeart, CircleHelp, Home as HomeIcon, Plus, Settings, Shield, Sparkles, Users, Wine } from 'lucide-react';
import { m, useAnimationControls } from 'motion/react';
import { useStore } from '../data/store';
import { pageOfRoute } from '../domain/help';
import { HelpSheet } from '../features/help/HelpSheet';
import { ResumeTour, TourProvider, useTour } from '../features/tour/Tour';
import { Discover } from '../features/auth/Discover';
import { Home } from '../features/home/Home';
import { CellarPage } from '../features/cellar/CellarPage';
import { WinePage } from '../features/cellar/WinePage';
import { AddSheet } from '../features/cellar/AddSheet';
import { WineFormSheet, type WinePrefill } from '../features/cellar/WineForm';
import { LabelScanSheet } from '../features/cellar/LabelScan';
import { TastingFormSheet, type TastingPrefill } from '../features/journal/TastingForm';
import { WishFormSheet, type WishPrefill } from '../features/journal/WishForm';
import { LegalNotice } from '../features/legal/LegalGate';
import { LegalPage } from '../features/legal/LegalViews';
import { PrivacyPage } from '../features/legal/PrivacyPage';
import { isLegalKind, LEGAL_TITLES } from '../domain/legal';
import { Avatar, Button, EmptyState, InlineLoading } from './kit';
import { go, routeQuery, useRoute, whenHistorySettled } from './router';
import { lazyPage } from './lazyPage';
import { PremiumIcon } from './PremiumIcon';
import { applyTheme, DEFAULT_THEME, isTheme } from './theme';
import { PageBoundary } from './PageBoundary';

// Pages chargées à leur première visite (l'accueil et la cave restent dans le premier chargement).
const FriendsPage = lazyPage(() => import('../features/friends/FriendsPage'), 'FriendsPage');
const NotificationsPage = lazyPage(() => import('../features/notifications/NotificationsPage'), 'NotificationsPage');
const GroupPage = lazyPage(() => import('../features/groups/GroupPage'), 'GroupPage');
const FriendCellar = lazyPage(() => import('../features/friends/FriendCellar'), 'FriendCellar');
const InvitePage = lazyPage(() => import('../features/friends/InvitePage'), 'InvitePage');
const EventsPage = lazyPage(() => import('../features/events/EventsPage'), 'EventsPage');
const EventPage = lazyPage(() => import('../features/events/EventPage'), 'EventPage');
const JournalPage = lazyPage(() => import('../features/journal/JournalPage'), 'JournalPage');
const TastePage = lazyPage(() => import('../features/journal/TastePage'), 'TastePage');
const TastingPage = lazyPage(() => import('../features/journal/TastingPage'), 'TastingPage');
const AssistantPage = lazyPage(() => import('../features/assistant/AssistantPage'), 'AssistantPage');
const SettingsPage = lazyPage(() => import('../features/settings/SettingsPage'), 'SettingsPage');
const CellarsPage = lazyPage(() => import('../features/settings/CellarsPage'), 'CellarsPage');
const WhoSeesPage = lazyPage(() => import('../features/settings/WhoSeesPage'), 'WhoSeesPage');
const AdminPage = lazyPage(() => import('../features/admin/AdminPage'), 'AdminPage');
const AdminJournal = lazyPage(() => import('../features/admin/AdminJournal'), 'AdminJournal');
const LegalAdmin = lazyPage(() => import('../features/admin/LegalAdmin'), 'LegalAdmin');
const ScannerPage = lazyPage(() => import('../features/scanner/ScannerPage'), 'ScannerPage');
const ScanPage = lazyPage(() => import('../features/scanner/ScanPage'), 'ScanPage');
const ScanHistory = lazyPage(() => import('../features/scanner/ScanHistory'), 'ScanHistory');
const ComparePage = lazyPage(() => import('../features/scanner/ComparePage'), 'ComparePage');

type Actions = {
  /** Fenêtre « Ajouter » : photo d'étiquette, saisie, dégustation, envie. */
  add: () => void;
  newWine: (prefill?: WinePrefill) => void;
  scanLabel: () => void;
  newTasting: (prefill?: TastingPrefill) => void;
  newWish: (prefill?: WishPrefill) => void;
  /** Aide de la page en cours (bouton « ? »). */
  help: () => void;
};

const ActionsContext = createContext<Actions>({ add: () => {}, newWine: () => {}, scanLabel: () => {}, newTasting: () => {}, newWish: () => {}, help: () => {} });

export function useActions() {
  return useContext(ActionsContext);
}

type Tab = { path: string; label: string; /** Libellé court de la barre du bas (téléphone). */ short?: string; icon: ReactNode; badge?: number };

/** Repère de la visite guidée pour un onglet (« nav-cave »…). */
const tourId = (path: string) => `nav-${path.slice(1) || 'accueil'}`;

export function Shell() {
  return (
    <TourProvider>
      <ShellInner />
    </TourProvider>
  );
}

function ShellInner() {
  const store = useStore();
  const { me, snapshot, online, local, userId } = store;
  const tour = useTour();
  const route = useRoute();
  const [sheet, setSheet] = useState<
    | { kind: 'add' }
    | { kind: 'wine'; prefill?: WinePrefill }
    | { kind: 'scan' }
    | { kind: 'tasting'; prefill?: TastingPrefill }
    | { kind: 'wish'; prefill?: WishPrefill }
    | { kind: 'help' }
    | null
  >(null);

  const actions = useMemo<Actions>(
    () => ({
      add: () => whenHistorySettled(() => setSheet({ kind: 'add' })),
      newWine: (prefill) => whenHistorySettled(() => setSheet({ kind: 'wine', prefill })),
      scanLabel: () => whenHistorySettled(() => setSheet({ kind: 'scan' })),
      newTasting: (prefill) => whenHistorySettled(() => setSheet({ kind: 'tasting', prefill })),
      newWish: (prefill) => whenHistorySettled(() => setSheet({ kind: 'wish', prefill })),
      help: () => whenHistorySettled(() => setSheet({ kind: 'help' })),
    }),
    [],
  );

  const pathOnly = route.split('?')[0];
  // Apparence choisie dans les Réglages ; à la déconnexion, retour au thème par défaut.
  const theme = isTheme(me.preferences?.theme) ? me.preferences.theme : DEFAULT_THEME;
  useEffect(() => {
    applyTheme(theme);
    return () => applyTheme(DEFAULT_THEME);
  }, [theme]);
  // Changement d'écran : retour en haut et fondu d'apparition (transparence seule : la page ne bouge pas sous le doigt).
  const pageFade = useAnimationControls();
  useEffect(() => {
    window.scrollTo(0, 0);
    void pageFade.start({ opacity: [0, 1], transition: { duration: 0.18, ease: 'easeOut' } });
  }, [pathOnly, pageFade]);

  // Accès direct « Ajouter une bouteille » (aide, Lia) : la fenêtre s'ouvre, l'adresse redevient celle de la page.
  useEffect(() => {
    if (routeQuery(route).get('ajouter') !== '1') return;
    go(pathOnly, { replace: true });
    actions.add();
  }, [route, pathOnly, actions]);

  const seg = pathOnly.split('/').filter(Boolean);
  // Événements où l'on attend ma réponse, ou mes bouteilles suggérées par d'autres : pastille sur l'onglet.
  const pendingRsvp = snapshot.participants.filter(
    (p) => p.user_id === userId && p.rsvp === 'pending' && snapshot.events.find((e) => e.id === p.event_id)?.status === 'planned',
  ).length;

  // Demandes reçues (contact, accès à ma cave), invitations à des groupes ou à gérer une cave : pastille sur l'onglet
  // Amis & Groupes.
  const incomingRequests =
    snapshot.requests.filter((r) => r.direction === 'in').length +
    snapshot.relations.filter((r) => r.request_in).length +
    snapshot.groups.filter((g) => g.my_status === 'invited').length +
    snapshot.cellarLinks.filter((l) => l.user_id === userId && l.status === 'invited').length;
  const unreadNotifications = snapshot.notifications.filter((n) => !n.read_at).length;

  const tabs: Tab[] = [
    // Icônes 3D de la maquette (40 px dans le menu, 32 px dans la barre du bas) ; pictogramme au trait en secours.
    { path: '/', label: 'Accueil', icon: <PremiumIcon name="accueil" fallback={<HomeIcon />} /> },
    { path: '/cave', label: 'Ma cave', icon: <PremiumIcon name="cave" fallback={<Wine />} /> },
    { path: '/amis', label: 'Amis & Groupes', short: 'Amis', icon: <PremiumIcon name="amis" fallback={<Users />} />, badge: incomingRequests },
    { path: '/evenements', label: 'Événements', icon: <PremiumIcon name="evenements" fallback={<CalendarHeart />} />, badge: pendingRsvp },
    { path: '/carnet', label: 'Mon carnet', icon: <PremiumIcon name="carnet" fallback={<BookOpen />} /> },
  ];

  let title = 'Cave & Amis';
  let back: string | null = null;
  let page: ReactNode;
  switch (seg[0]) {
    case undefined:
      title = 'Cave & Amis';
      page = <Home />;
      break;
    case 'cave':
      if (seg[1] === 'vin' && seg[2]) {
        title = 'Fiche du vin';
        back = '/cave';
        page = <WinePage id={seg[2]} />;
      } else {
        title = 'Ma cave';
        page = <CellarPage />;
      }
      break;
    case 'amis':
      if (seg[1]) {
        title = store.profileName(seg[1]);
        back = '/amis';
        page = <FriendCellar friendId={seg[1]} />;
      } else {
        title = 'Amis & Groupes';
        page = <FriendsPage />;
      }
      break;
    case 'ami':
      title = 'Invitation';
      back = '/amis';
      page = <InvitePage code={seg[1] ?? ''} />;
      break;
    case 'notifications':
      title = 'Notifications';
      page = <NotificationsPage />;
      break;
    case 'groupes':
      title = 'Groupe';
      back = '/amis?onglet=groupes';
      page = seg[1] ? <GroupPage id={seg[1]} /> : <FriendsPage />;
      break;
    case 'evenements':
      if (seg[1]) {
        title = 'Événement';
        back = '/evenements';
        page = <EventPage id={seg[1]} />;
      } else {
        title = 'Événements';
        page = <EventsPage />;
      }
      break;
    case 'carnet':
      if (seg[1] === 'degustation' && seg[2]) {
        title = 'Dégustation';
        back = '/carnet';
        page = <TastingPage id={seg[2]} />;
      } else if (seg[1] === 'gouts') {
        title = 'Mes goûts';
        back = '/carnet';
        page = <TastePage />;
      } else {
        title = 'Mon carnet';
        page = <JournalPage />;
      }
      break;
    case 'scanner':
      if (seg[1] === 'visite' && seg[2]) {
        title = 'Comparer les bouteilles';
        back = '/scanner/historique';
        page = <ComparePage id={seg[2]} />;
      } else if (seg[1] === 'historique') {
        title = 'Mes analyses';
        back = '/scanner';
        page = <ScanHistory />;
      } else if (seg[1]) {
        title = 'Vérifier la bouteille';
        back = '/scanner/historique';
        page = <ScanPage id={seg[1]} />;
      } else {
        title = 'Scanner avant d’acheter';
        page = <ScannerPage />;
      }
      break;
    case 'assistant':
      title = 'Assistant';
      page = <AssistantPage conversationId={seg[1] ?? null} />;
      break;
    case 'reglages':
      if (seg[1] === 'caves') {
        title = 'Caves et emplacements';
        back = '/reglages';
        page = <CellarsPage />;
      } else if (seg[1] === 'acces') {
        title = 'Qui voit ma cave';
        back = '/reglages';
        page = <WhoSeesPage />;
      } else if (seg[1] === 'confidentialite') {
        title = 'Confidentialité et mes données';
        back = '/reglages';
        page = <PrivacyPage />;
      } else {
        title = 'Réglages';
        page = <SettingsPage />;
      }
      break;
    case 'decouvrir':
      title = 'Découvrir l’application';
      back = '/';
      page = (
        <Discover
          actions={
            <>
              <Button size="lg" block onClick={() => tour.start(0)}>
                Faire la visite guidée
              </Button>
              <Button variant="secondary" block onClick={() => go('/')}>
                Revenir à l’accueil
              </Button>
            </>
          }
        />
      );
      break;
    case 'admin':
      title = 'Administration';
      back = '/reglages';
      page = me.is_admin ? (
        <>
          <LegalAdmin />
          <AdminPage />
          <AdminJournal />
        </>
      ) : (
        <EmptyState icon="🔒" title="Espace réservé à l’administrateur" />
      );
      break;
    case 'legal':
      if (isLegalKind(seg[1])) {
        title = LEGAL_TITLES[seg[1]];
        back = '/reglages/confidentialite';
        page = <LegalPage api={store.api} kind={seg[1]} />;
      } else page = <EmptyState icon="🧭" title="Page introuvable" action={<Button onClick={() => go('/')}>Revenir à l’accueil</Button>} />;
      break;
    default:
      page = (
        <EmptyState icon="🧭" title="Page introuvable" action={<Button onClick={() => go('/')}>Revenir à l’accueil</Button>}>
          Ce lien ne correspond à aucune page.
        </EmptyState>
      );
  }

  const activeTab = '/' + (seg[0] === 'ami' || seg[0] === 'groupes' ? 'amis' : (seg[0] ?? ''));

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        {/* Clavier : passer directement au contenu (le lien ne change pas d'écran). */}
        <a
          className="skip-link"
          href="#contenu"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('contenu')?.focus();
          }}
        >
          Aller au contenu
        </a>
        <nav className="sidenav" aria-label="Navigation principale">
          <div className="brand-small">
            <img src="/img/logo-cave.webp" alt="" width={34} height={34} />
            Cave &amp; Amis
          </div>
          <Button className="add-btn" icon={<Plus />} onClick={actions.add} data-tour="ajouter">
            Ajouter un vin
          </Button>
          {/* Ordre de la maquette : Accueil, Ma cave, Lia, Événements, Amis… (libellés courts). */}
          {[tabs[0], tabs[1], { path: '/assistant', label: 'Lia (IA)', icon: <PremiumIcon name="lia" fallback={<Sparkles />} /> } as Tab, tabs[3], tabs[2], ...tabs.slice(4)].map((t) => (
            <a key={t.path} href={`#${t.path}`} aria-current={activeTab === t.path ? 'page' : undefined} data-tour={tourId(t.path)}>
              {t.icon}
              {t.short ?? t.label}
              {!!t.badge && <span className="pill primary" style={{ marginLeft: 'auto' }}>{t.badge}</span>}
            </a>
          ))}
          <div className="spacer" />
          {me.is_admin && (
            <a href="#/admin" aria-current={activeTab === '/admin' ? 'page' : undefined}>
              <PremiumIcon name="administration" fallback={<Shield />} />
              Administration
            </a>
          )}
          <a href="#/reglages" aria-current={activeTab === '/reglages' ? 'page' : undefined}>
            <PremiumIcon name="parametres" fallback={<Settings />} />
            Paramètres
          </a>
        </nav>
        {local && <div className="local-banner">Serveur local de test : rien n’est en ligne</div>}
        {!online && <div className="offline-banner">Pas de connexion internet : les informations affichées peuvent dater un peu.</div>}
        <header className="topbar">
          <div className="topbar-inner">
            {back && (
              <button type="button" className="icon-btn" aria-label="Retour" onClick={() => (history.length > 1 ? history.back() : go(back!))}>
                <ArrowLeft />
              </button>
            )}
            <h1>{title}</h1>
            <a
              className="icon-btn"
              href="#/notifications"
              aria-label={unreadNotifications ? `Notifications (${unreadNotifications} nouvelle${unreadNotifications > 1 ? 's' : ''})` : 'Notifications'}
              title="Notifications"
            >
              <Bell />
              {unreadNotifications > 0 && (
                <span className="dot-count" aria-hidden>
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </a>
            <button type="button" className="icon-btn" aria-label="Aide de cette page" title="Aide" onClick={actions.help} data-tour="aide">
              <CircleHelp />
            </button>
            {seg[0] !== 'assistant' && (
              <a className="icon-btn accent" href="#/assistant" aria-label="Assistant sommelier" title="Assistant sommelier" data-tour="lia">
                <Sparkles />
              </a>
            )}
            <span data-tour="reglages" style={{ display: 'inline-flex', borderRadius: '50%' }}>
              <Avatar name={me.display_name} seed={me.id} onClick={() => go('/reglages')} label={`Réglages et compte de ${me.display_name}`} />
            </span>
          </div>
        </header>
        <m.main className="page" id="contenu" tabIndex={-1} animate={pageFade}>
          {seg[0] === undefined && <ResumeTour />}
          <LegalNotice />
          {/* Une page par chemin : les paramètres (?…) qu'une page ajoute ou retire ne la remontent pas. */}
          <PageBoundary key={pathOnly}>
            <Suspense fallback={<InlineLoading />}>{page}</Suspense>
          </PageBoundary>
        </m.main>        {!['assistant', 'admin', 'reglages', 'scanner', 'legal'].includes(seg[0] ?? '') && (
          <button type="button" className="fab" onClick={actions.add} data-tour="ajouter">
            <Plus aria-hidden />
            Ajouter
          </button>
        )}
        <nav className="tabbar" aria-label="Navigation principale">
          <div className="tabbar-inner">
            {tabs.map((t) => (
              <a
                key={t.path}
                href={`#${t.path}`}
                className="tab"
                aria-label={t.badge ? `${t.label} (${t.badge} en attente)` : t.label}
                aria-current={activeTab === t.path ? 'page' : undefined}
                data-tour={tourId(t.path)}
              >
                {t.icon}
                <span>{t.short ?? t.label}</span>
                {!!t.badge && (
                  <span className="badge" aria-hidden>
                    {t.badge}
                  </span>
                )}
              </a>
            ))}
          </div>
        </nav>
      </div>
      <AddSheet open={sheet?.kind === 'add'} onClose={() => setSheet(null)} />
      {sheet?.kind === 'wine' && <WineFormSheet prefill={sheet.prefill} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'scan' && <LabelScanSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'tasting' && <TastingFormSheet prefill={sheet.prefill} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'wish' && <WishFormSheet prefill={sheet.prefill} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'help' && <HelpSheet page={pageOfRoute(route)} onClose={() => setSheet(null)} />}
    </ActionsContext.Provider>
  );
}
