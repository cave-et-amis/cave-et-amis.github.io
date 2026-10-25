/** Cadre de l'application connectée : barre du haut, onglets (téléphone) ou navigation latérale (ordinateur), fenêtres globales. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Bell, BookOpen, CalendarHeart, Home as HomeIcon, Plus, Settings, Shield, Sparkles, Users, Wine } from 'lucide-react';
import { useStore } from '../data/store';
import { Home } from '../features/home/Home';
import { CellarPage } from '../features/cellar/CellarPage';
import { WinePage } from '../features/cellar/WinePage';
import { AddSheet } from '../features/cellar/AddSheet';
import { WineFormSheet, type WinePrefill } from '../features/cellar/WineForm';
import { LabelScanSheet } from '../features/cellar/LabelScan';
import { FriendsPage } from '../features/friends/FriendsPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { GroupPage } from '../features/groups/GroupPage';
import { FriendCellar } from '../features/friends/FriendCellar';
import { InvitePage } from '../features/friends/InvitePage';
import { EventsPage } from '../features/events/EventsPage';
import { EventPage } from '../features/events/EventPage';
import { JournalPage } from '../features/journal/JournalPage';
import { TastingPage } from '../features/journal/TastingPage';
import { TastingFormSheet, type TastingPrefill } from '../features/journal/TastingForm';
import { WishFormSheet, type WishPrefill } from '../features/journal/WishForm';
import { AssistantPage } from '../features/assistant/AssistantPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { CellarsPage } from '../features/settings/CellarsPage';
import { WhoSeesPage } from '../features/settings/WhoSeesPage';
import { AdminPage } from '../features/admin/AdminPage';
import { ScannerPage } from '../features/scanner/ScannerPage';
import { ScanPage } from '../features/scanner/ScanPage';
import { ScanHistory } from '../features/scanner/ScanHistory';
import { Avatar, Button, EmptyState } from './kit';
import { go, useRoute, whenHistorySettled } from './router';

type Actions = {
  /** Fenêtre « Ajouter » : photo d'étiquette, saisie, dégustation, envie. */
  add: () => void;
  newWine: (prefill?: WinePrefill) => void;
  scanLabel: () => void;
  newTasting: (prefill?: TastingPrefill) => void;
  newWish: (prefill?: WishPrefill) => void;
};

const ActionsContext = createContext<Actions>({ add: () => {}, newWine: () => {}, scanLabel: () => {}, newTasting: () => {}, newWish: () => {} });

export function useActions() {
  return useContext(ActionsContext);
}

type Tab = { path: string; label: string; /** Libellé court de la barre du bas (téléphone). */ short?: string; icon: ReactNode; badge?: number };

export function Shell() {
  const store = useStore();
  const { me, snapshot, online, local, userId } = store;
  const route = useRoute();
  const [sheet, setSheet] = useState<
    | { kind: 'add' }
    | { kind: 'wine'; prefill?: WinePrefill }
    | { kind: 'scan' }
    | { kind: 'tasting'; prefill?: TastingPrefill }
    | { kind: 'wish'; prefill?: WishPrefill }
    | null
  >(null);

  const actions = useMemo<Actions>(
    () => ({
      add: () => whenHistorySettled(() => setSheet({ kind: 'add' })),
      newWine: (prefill) => whenHistorySettled(() => setSheet({ kind: 'wine', prefill })),
      scanLabel: () => whenHistorySettled(() => setSheet({ kind: 'scan' })),
      newTasting: (prefill) => whenHistorySettled(() => setSheet({ kind: 'tasting', prefill })),
      newWish: (prefill) => whenHistorySettled(() => setSheet({ kind: 'wish', prefill })),
    }),
    [],
  );

  const pathOnly = route.split('?')[0];
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathOnly]);

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
    { path: '/', label: 'Accueil', icon: <HomeIcon /> },
    { path: '/cave', label: 'Ma cave', icon: <Wine /> },
    { path: '/amis', label: 'Amis & Groupes', short: 'Amis', icon: <Users />, badge: incomingRequests },
    { path: '/evenements', label: 'Événements', icon: <CalendarHeart />, badge: pendingRsvp },
    { path: '/carnet', label: 'Mon carnet', icon: <BookOpen /> },
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
      } else {
        title = 'Mon carnet';
        page = <JournalPage />;
      }
      break;
    case 'scanner':
      if (seg[1] === 'historique') {
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
      } else {
        title = 'Réglages';
        page = <SettingsPage />;
      }
      break;
    case 'admin':
      title = 'Administration';
      back = '/reglages';
      page = me.is_admin ? <AdminPage /> : <EmptyState icon="🔒" title="Espace réservé à l’administrateur" />;
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
        <nav className="sidenav" aria-label="Navigation principale">
          <div className="brand-small">
            <img src="./icon.svg" alt="" width={34} height={34} />
            Cave &amp; Amis
          </div>
          <Button className="add-btn" icon={<Plus />} onClick={actions.add}>
            Ajouter un vin
          </Button>
          {tabs.map((t) => (
            <a key={t.path} href={`#${t.path}`} aria-current={activeTab === t.path ? 'page' : undefined}>
              {t.icon}
              {t.label}
              {!!t.badge && <span className="pill primary" style={{ marginLeft: 'auto' }}>{t.badge}</span>}
            </a>
          ))}
          <a href="#/assistant" aria-current={activeTab === '/assistant' ? 'page' : undefined}>
            <Sparkles />
            Assistant
          </a>
          <div className="spacer" />
          {me.is_admin && (
            <a href="#/admin" aria-current={activeTab === '/admin' ? 'page' : undefined}>
              <Shield />
              Administration
            </a>
          )}
          <a href="#/reglages" aria-current={activeTab === '/reglages' ? 'page' : undefined}>
            <Settings />
            Réglages
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
            {seg[0] !== 'assistant' && (
              <a className="icon-btn accent" href="#/assistant" aria-label="Assistant sommelier" title="Assistant sommelier">
                <Sparkles />
              </a>
            )}
            <Avatar name={me.display_name} seed={me.id} onClick={() => go('/reglages')} label={`Réglages et compte de ${me.display_name}`} />
          </div>
        </header>
        <main className="page" id="contenu">
          {page}
        </main>
        {!['assistant', 'admin', 'reglages', 'scanner'].includes(seg[0] ?? '') && (
          <button type="button" className="fab" onClick={actions.add}>
            <Plus aria-hidden />
            Ajouter
          </button>
        )}
        <nav className="tabbar" aria-label="Navigation principale">
          <div className="tabbar-inner">
            {tabs.map((t) => (
              <a key={t.path} href={`#${t.path}`} className="tab" aria-label={t.badge ? `${t.label} (${t.badge} en attente)` : t.label} aria-current={activeTab === t.path ? 'page' : undefined}>
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
    </ActionsContext.Provider>
  );
}
