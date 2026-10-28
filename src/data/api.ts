/**
 * Tous les échanges avec le serveur (Supabase). Chaque méthode lève une erreur en cas d'échec ;
 * les messages sont traduits par domain/errors.ts. Les règles (droits, stocks, réservations) sont
 * appliquées par la base : l'interface ne fait que les demander.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type {
  EventLiveState,
  PriceWatch,
  GroupPurchase,
  AccessScope,
  AppNotification,
  Block,
  CaveEvent,
  CellarException,
  CellarLink,
  DetailLevel,
  InviteKind,
  InviteOptions,
  InviteRedemption,
  PreviewLot,
  Relation,
  RelationOverview,
  FriendRequest,
  GroupActivity,
  GroupLot,
  GroupMember,
  GroupNote,
  GroupWish,
  GroupShare,
  Cellar,
  Dish,
  EventWine,
  FriendInvite,
  Friendship,
  Location,
  Lot,
  MarketPrice,
  Movement,
  MyGroup,
  Participant,
  PersonName,
  Preferences,
  PriceCheck,
  Scan,
  ScanVisit,
  Profile,
  SharedLot,
  SuggestableLot,
  Tasting,
  UserResult,
  Wine,
  WishItem,
} from '../domain/types';
import type { TasteProfile } from '../domain/tasteProfile';
import { AppError } from '../domain/errors';
import type { LegalDoc, LegalHistory, LegalKind, LegalPending, LegalStats } from '../domain/legal';
import { clearDeviceData } from './deviceData';
import { thisDeviceEndpoint, type DeviceSubscription } from './pushDevice';
import { AI_MESSAGES } from '../domain/errors';

export type Snapshot = {
  /** Mon profil complet : la base ne donne que le sien. */
  me: Profile;
  /** Prénoms des personnes que je connais : moi, mes contacts, les participants de mes événements. */
  people: PersonName[];
  cellars: Cellar[];
  locations: Location[];
  wines: Wine[];
  lots: Lot[];
  friendships: Friendship[];
  /** Mes relations : qui voit la cave de qui, demandes d'accès en attente. */
  relations: Relation[];
  invites: FriendInvite[];
  events: CaveEvent[];
  participants: Participant[];
  tastings: Tasting[];
  wishlist: WishItem[];
  prices: MarketPrice[];
  /** Mes bouteilles proposées ou réservées pour des événements. */
  myEventWines: EventWine[];
  /** Demandes d'ami en attente (reçues et envoyées). */
  requests: FriendRequest[];
  blocks: Block[];
  /** 50 dernières notifications. */
  notifications: AppNotification[];
  /** Mes groupes (membre ou invité). */
  groups: MyGroup[];
  /** Mes lots rendus visibles dans des groupes. */
  groupShares: GroupShare[];
  /** Caves gérées à plusieurs : personnes associées à mes caves, caves où je suis associé ou invité. */
  cellarLinks: CellarLink[];
};

export type EventDetail = { participants: Participant[]; dishes: Dish[]; wines: EventWine[]; suggestable: SuggestableLot[]; tastings: Tasting[] };

export type AiStatus = {
  enabled: boolean;
  key_status: 'unknown' | 'ok' | 'missing' | 'invalid';
  web_search: boolean;
  blocked: boolean;
  requests_today: number;
  daily_limit: number;
  month_pct: number;
  budget_reached: boolean;
  max_input_chars: number;
  max_image_bytes: number;
  is_admin: boolean;
};

/** Un de mes appareils qui reçoivent les notifications push. */
export type PushDevice = { id: string; label: string | null; endpoint: string; created_at: string; last_success_at: string | null };

export type AiReply = { ok: true; [k: string]: unknown } | { ok: false; code: string; message: string };

export type Conversation = { id: string; title: string; context_kind: 'wine' | 'event' | 'group' | 'scan' | null; context_id: string | null; created_at: string; updated_at: string };
export type AiMessage = { id: string; conversation_id: string; role: 'user' | 'assistant'; content: string; meta: Record<string, unknown>; created_at: string };

type Result<T> = { data: T | null; error: unknown };

function must<T>(res: Result<T>): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/** Lit toutes les lignes d'une table par pages de 1 000 (limite de Supabase). */
async function pages<T>(fetchPage: (from: number, to: number) => PromiseLike<Result<T[]>>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await fetchPage(from, from + 999)) ?? [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

export const newId = () => crypto.randomUUID();

/** Mon code de double authentification actif (application d'authentification). */
export type MfaFactor = { id: string; created_at: string; updated_at: string };
/** Activation commencée : clé à recopier à la main et adresse otpauth:// du QR code (jamais à journaliser). */
export type MfaEnrollment = { id: string; secret: string; uri: string };

export class Api {
  sb: SupabaseClient;
  /** Clé de site Cloudflare Turnstile : quand elle est configurée, connexion, inscription et « mot de passe oublié » exigent un jeton. */
  readonly captchaSiteKey: string | null;
  /** Client à part, sans session gardée : vérifie un mot de passe sans remplacer la session de l'application. */
  private checker: (() => SupabaseClient) | null;
  constructor(sb: SupabaseClient, options: { captchaSiteKey?: string | null; checker?: (() => SupabaseClient) | null } = {}) {
    this.sb = sb;
    this.captchaSiteKey = options.captchaSiteKey || null;
    this.checker = options.checker ?? null;
  }

  /** Jeton du contrôle anti-robots joint à l'appel : exigé avec une clé Turnstile, jamais envoyé sans. */
  private captcha(token: string | null | undefined): { captchaToken?: string } {
    if (!this.captchaSiteKey) return {};
    if (!token) throw new AppError('Le contrôle anti-robots n’est pas terminé : patientez un instant, ou cochez la case s’il la propose.', 'captcha_pending');
    return { captchaToken: token };
  }

  // ───────────── Comptes ─────────────

  async getSession(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session;
  }

  /** Vérifie auprès du serveur que la session de cet appareil est encore ouverte ; fermée ailleurs, supabase-js la retire. */
  async checkSession() {
    await this.sb.auth.getUser();
  }

  /** Connexion par un lien à usage unique (agenda Nous) ; null si le lien n'est plus valable. */
  async verifyLink(tokenHash: string): Promise<Session | null> {
    const { data, error } = await this.sb.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    return error ? null : data.session;
  }

  /** Lien « mot de passe oublié » : ouvre une session de récupération ; null si le lien n'est plus valable. */
  async verifyRecovery(tokenHash: string): Promise<Session | null> {
    const { data, error } = await this.sb.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
    return error ? null : data.session;
  }

  /**
   * Lien de confirmation d'inscription : ouvre la session du compte confirmé ; null si le lien n'est plus valable.
   * Réseau coupé : lève l'erreur (le lien n'a pas été essayé et reste valable).
   */
  async verifySignup(tokenHash: string): Promise<Session | null> {
    const { data, error } = await this.sb.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
    if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0)) throw error;
    return error ? null : data.session;
  }

  /**
   * Lien de changement d'adresse. « done » : changement fait (session à jour) ; « other » : lien accepté, il reste à ouvrir
   * celui envoyé à l'autre adresse (les deux sont exigés) ; « expired » : lien plus valable.
   */
  async verifyEmailChange(tokenHash: string): Promise<{ result: 'done'; session: Session } | { result: 'other' | 'expired' }> {
    const { data, error } = await this.sb.auth.verifyOtp({ type: 'email_change', token_hash: tokenHash });
    if (error) return { result: 'expired' };
    return data.session ? { result: 'done', session: data.session } : { result: 'other' };
  }

  /**
   * Changer d'adresse e-mail : Supabase envoie un lien à la nouvelle adresse et un à l'actuelle ; le changement se fait
   * quand les deux sont ouverts. Rien ne change d'ici là.
   */
  async changeEmail(newEmail: string) {
    const { error } = await this.sb.auth.updateUser({ email: newEmail.trim() });
    if (error) throw error;
  }

  /** Nouvelle adresse en attente de confirmation (null : aucune). */
  async pendingEmail(): Promise<string | null> {
    const { data } = await this.sb.auth.getUser();
    return (data.user as { new_email?: string | null } | null)?.new_email ?? null;
  }

  /** Nouveau lien de confirmation d'inscription (adresse pas encore confirmée). */
  async resendConfirmation(email: string, captchaToken?: string | null) {
    const { error } = await this.sb.auth.resend({ type: 'signup', email: email.trim(), options: this.captcha(captchaToken) });
    if (error) throw error;
  }

  /** Prénom affiché du compte connecté (null s'il n'a pas pu être lu). */
  async displayName(userId: string): Promise<string | null> {
    const { data } = await this.sb.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    return (data as { display_name?: string } | null)?.display_name ?? null;
  }

  async signIn(email: string, password: string, captchaToken?: string | null) {
    const { error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password, options: this.captcha(captchaToken) });
    if (error) throw error;
  }

  /** `legal` : versions des conditions acceptées et de la politique présentée, notées par la base avec le compte. */
  async signUp(
    name: string,
    email: string,
    password: string,
    legal: { cgu_version?: number; confidentialite_version?: number } = {},
    captchaToken?: string | null,
  ) {
    const meta: Record<string, string> = { display_name: name.trim() };
    if (legal.cgu_version) meta.cgu_version = String(legal.cgu_version);
    if (legal.confidentialite_version) meta.confidentialite_version = String(legal.confidentialite_version);
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password, options: { data: meta, ...this.captcha(captchaToken) } });
    if (error) throw error;
    return { needsConfirmation: !data.session };
  }

  async signOut() {
    // Un appareil partagé ne reçoit plus les notifications de la personne qui se déconnecte.
    const endpoint = await thisDeviceEndpoint();
    if (endpoint) await this.sb.rpc('remove_push_endpoint', { p_endpoint: endpoint }).then(() => undefined, () => undefined);
    await this.sb.auth.signOut({ scope: 'local' });
    // Préférences de confort, code d'invitation, brouillon du scanner : rien ne reste pour la personne suivante.
    await clearDeviceData();
  }

  /**
   * « Déconnecter tous mes appareils » : plus aucun appareil ne reçoit mes notifications, puis toutes mes sessions sont
   * fermées (celle-ci comprise) et le confort de cet appareil est effacé, comme à la déconnexion simple.
   */
  async signOutEverywhere() {
    for (const d of await this.myPushDevices()) await this.removePushDevice(d.id);
    const { error } = await this.sb.auth.signOut({ scope: 'global' });
    // Même si le serveur n'a pas répondu, supabase-js a fermé la session de cet appareil.
    await clearDeviceData();
    if (error) throw new AppError('Cet appareil est déconnecté, mais les autres n’ont peut-être pas pu l’être. Reconnectez-vous, puis recommencez.', 'signout_partial');
  }

  async resetPassword(email: string, captchaToken?: string | null) {
    const captcha = this.captcha(captchaToken);
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo, ...captcha });
    if (error) throw error;
  }

  /** `current` : mot de passe actuel, exigé par le serveur de connexion quand le réglage correspondant est activé. */
  async updatePassword(password: string, current?: string) {
    const { error } = await this.sb.auth.updateUser({ password, ...(current ? { current_password: current } : {}) });
    if (error) throw error;
  }

  /**
   * Vérifie le mot de passe actuel avant un changement sensible : une session restée ouverte ne suffit pas. C'est une
   * connexion : avec une clé Turnstile, elle exige elle aussi un jeton du contrôle anti-robots. Avec le client à part, la
   * session de l'application reste celle vérifiée par le code de double authentification (le serveur l'exige pour changer
   * de mot de passe).
   */
  async verifyPassword(password: string, captchaToken?: string | null) {
    const captcha = this.captcha(captchaToken);
    const { data } = await this.sb.auth.getUser();
    const email = data.user?.email;
    if (!email) throw new AppError('Session expirée : reconnectez-vous.', 'not_authenticated');
    const client = this.checker?.() ?? this.sb;
    const { error } = await client.auth.signInWithPassword({ email, password, options: captcha });
    // Contrôle anti-robots refusé : le dire, plutôt que « mot de passe incorrect ».
    if (error) throw error.code === 'captcha_failed' ? error : new AppError('Mot de passe actuel incorrect.', 'invalid_password');
    if (client !== this.sb) await client.auth.signOut({ scope: 'local' });
  }

  // ───────────── Double authentification (code à 6 chiffres d'une application d'authentification) ─────────────

  /**
   * Faut-il demander le code avant d'entrer ? Oui quand le compte a un code actif et que la session n'est passée que par
   * le mot de passe (niveau aal1). Avec `token`, les codes sont relus sur le serveur (activés depuis un autre appareil
   * compris) ; sans réseau, d'après la session gardée sur l'appareil.
   */
  async mfaRequired(token?: string) {
    const mfa = this.sb.auth.mfa;
    let res = token ? await mfa.getAuthenticatorAssuranceLevel(token) : null;
    if (!res || res.error) res = await mfa.getAuthenticatorAssuranceLevel();
    if (res.error) throw res.error;
    return res.data.nextLevel === 'aal2' && res.data.currentLevel !== 'aal2';
  }

  /** Mon code actif (null : double authentification désactivée), relu sur le serveur. */
  async mfaFactor(): Promise<MfaFactor | null> {
    const { data, error } = await this.sb.auth.mfa.listFactors();
    if (error) throw error;
    const f = data.totp[0];
    return f ? { id: f.id, created_at: f.created_at, updated_at: f.updated_at } : null;
  }

  /** Commence l'activation : le nouveau code n'est actif qu'une fois vérifié. Les activations abandonnées sont retirées. */
  async mfaEnroll(): Promise<MfaEnrollment> {
    const { data: list, error: listError } = await this.sb.auth.mfa.listFactors();
    if (listError) throw listError;
    for (const f of list.all) if (f.factor_type === 'totp' && f.status === 'unverified') await this.mfaUnenroll(f.id);
    const { data, error } = await this.sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'Cave & Amis' });
    if (error) throw error;
    return { id: data.id, secret: data.totp.secret, uri: data.totp.uri };
  }

  /** Vérifie un code à 6 chiffres (fin de l'activation, ou connexion) : la session passe au niveau aal2. */
  async mfaVerify(factorId: string, code: string) {
    const { data: challenge, error } = await this.sb.auth.mfa.challenge({ factorId });
    if (error) throw error;
    const { error: verifyError } = await this.sb.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
    if (verifyError) throw verifyError;
  }

  /** Code demandé à la connexion. */
  async mfaSignIn(code: string) {
    const factor = await this.mfaFactor();
    if (!factor) throw new AppError('La double authentification n’est plus active sur ce compte : rechargez la page.', 'mfa_factor_not_found');
    await this.mfaVerify(factor.id, code);
  }

  /** Retire un code ; un code actif ne se retire qu'avec une session vérifiée par lui. */
  async mfaUnenroll(factorId: string) {
    const { error } = await this.sb.auth.mfa.unenroll({ factorId });
    if (error) throw error;
  }

  async updateProfile(id: string, patch: Partial<Pick<Profile, 'display_name' | 'currency' | 'preferences'>>) {
    must(await this.sb.from('profiles').update(patch).eq('id', id));
  }
  /** Fusionne dans mes préférences, côté base : une préférence n'en écrase jamais une autre. */
  async mergePreferences(patch: Partial<Preferences>) {
    return must(await this.sb.rpc('merge_preferences', { p: patch })) as Preferences;
  }

  // ───────────── Chargement ─────────────

  async load(userId: string): Promise<Snapshot> {
    const sb = this.sb;
    const [me, people, cellars, locations, wines, lots, friendships, relations, invites, events, participants, tastings, wishlist, prices, myEventWines, requests, blocks, notifications, groups, groupShares, cellarLinks] = await Promise.all([
      sb.from('profiles').select('*').eq('id', userId).maybeSingle().then((r) => must(r) as Profile | null),
      sb.rpc('profile_names').then((r) => must(r) as PersonName[]),
      pages<Cellar>((a, b) => sb.from('cellars').select('*').order('position').order('created_at').range(a, b)),
      pages<Location>((a, b) => sb.from('locations').select('*').order('position').order('name').range(a, b)),
      pages<Wine>((a, b) => sb.from('wines').select('*').order('name').order('id').range(a, b)),
      pages<Lot>((a, b) => sb.from('lots').select('*').order('created_at').order('id').range(a, b)),
      pages<Friendship>((a, b) => sb.from('friendships').select('*').range(a, b)),
      sb.rpc('my_relations').then((r) => must(r) as Relation[]),
      pages<FriendInvite>((a, b) =>
        sb
          .from('friend_invites')
          .select('id, inviter_id, status, created_at, expires_at, kind, target_id, max_uses, uses, code, note, options')
          .order('created_at', { ascending: false })
          .range(a, b),
      ),
      pages<CaveEvent>((a, b) => sb.from('events').select('*').order('starts_at').range(a, b)),
      pages<Participant>((a, b) => sb.from('event_participants').select('*').range(a, b)),
      pages<Tasting>((a, b) => sb.from('tastings').select('*').eq('user_id', userId).order('tasted_on', { ascending: false }).order('id').range(a, b)),
      pages<WishItem>((a, b) => sb.from('wishlist').select('*').order('created_at', { ascending: false }).range(a, b)),
      pages<MarketPrice>((a, b) => sb.from('market_prices').select('*').order('checked_at', { ascending: false }).range(a, b)),
      pages<EventWine>((a, b) => sb.from('event_wines').select('*').eq('owner_id', userId).in('status', ['proposed', 'confirmed']).range(a, b)),
      sb.rpc('my_friend_requests').then((r) => must(r) as FriendRequest[]),
      sb.rpc('my_blocks').then((r) => must(r) as Block[]),
      sb
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
        .then((r) => must(r) as AppNotification[]),
      sb.rpc('my_groups').then((r) => must(r) as MyGroup[]),
      pages<GroupShare>((a, b) => sb.from('group_shares').select('*').eq('owner_id', userId).range(a, b)),
      sb.rpc('my_cellar_links').then((r) => must(r) as CellarLink[]),
    ]);
    if (!me) throw new AppError('Votre profil est introuvable. Reconnectez-vous.', 'not_found');
    // Mes caves d'abord, puis celles que je gère avec leur propriétaire.
    cellars.sort((a, b) => Number(a.owner_id !== userId) - Number(b.owner_id !== userId));
    return { me, people, cellars, locations, wines, lots, friendships, relations, invites, events, participants, tastings, wishlist, prices, myEventWines, requests, blocks, notifications, groups, groupShares, cellarLinks };
  }

  // ───────────── Caves et emplacements ─────────────

  async addCellar(c: Pick<Cellar, 'name' | 'storage'> & { notes?: string | null }) {
    return must(await this.sb.from('cellars').insert(c).select().single()) as Cellar;
  }
  async updateCellar(id: string, patch: Partial<Cellar>) {
    must(await this.sb.from('cellars').update(patch).eq('id', id));
  }
  async deleteCellar(id: string) {
    must(await this.sb.from('cellars').delete().eq('id', id));
  }
  /**
   * Déplacer des bouteilles libres d'un lot vers un emplacement de la même cave (null : sans emplacement). Une partie du
   * lot devient un lot jumeau ; aucun mouvement de stock (le total ne change pas). Idempotent par `requestId`.
   * `cellar` : une autre de mes caves (vide : la cave du lot). `whole` : tout le lot, réservations comprises (elles le
   * suivent) ; sinon seulement des bouteilles libres.
   */
  async moveBottles(lot: string, quantity: number, cellar: string | null, location: string | null, requestId: string, whole = false) {
    return must(
      await this.sb.rpc('move_bottles', { p_lot: lot, p_quantity: quantity, p_cellar: cellar, p_location: location, p_request: requestId, p_whole: whole }),
    ) as {
      lot_id: string;
      moved_lot_id: string;
      quantity: number;
    };
  }
  async addLocation(l: Pick<Location, 'cellar_id' | 'name' | 'kind'> & Partial<Pick<Location, 'rows' | 'slots_per_row'>>) {
    return must(await this.sb.from('locations').insert(l).select().single()) as Location;
  }
  async updateLocation(id: string, patch: Partial<Location>) {
    must(await this.sb.from('locations').update(patch).eq('id', id));
  }
  async deleteLocation(id: string) {
    must(await this.sb.from('locations').delete().eq('id', id));
  }

  // ───────────── Caves gérées à plusieurs ─────────────

  async inviteToCellar(cellar: string, users: string[]) {
    return must(await this.sb.rpc('invite_to_cellar', { p_cellar: cellar, p_users: users })) as number;
  }
  async respondCellarInvite(cellar: string, accept: boolean) {
    return must(await this.sb.rpc('respond_cellar_invite', { p_cellar: cellar, p_accept: accept })) as 'active' | 'declined';
  }
  /** Le propriétaire retire une personne (ou annule son invitation) ; avec mon propre identifiant : je quitte la cave. */
  async removeCellarMember(cellar: string, user: string) {
    must(await this.sb.rpc('remove_cellar_member', { p_cellar: cellar, p_user: user }));
  }

  // ───────────── Vins, lots, mouvements ─────────────

  /**
   * Création idempotente : l'identifiant est choisi par l'appareil ; un nouvel envoi retombe sur la même fiche (doublon
   * d'identifiant ignoré). Simple insertion, sans relire la ligne : c'est ce qui permet à une personne associée de créer
   * une fiche au nom du propriétaire d'une cave partagée (elle ne la voit qu'une fois les bouteilles ajoutées).
   */
  async saveNewWine(w: Partial<Wine> & { id: string; name: string }) {
    const { error } = await this.sb.from('wines').insert(w);
    if (error && error.code !== '23505') throw error;
  }
  async updateWine(id: string, patch: Partial<Wine>) {
    must(await this.sb.from('wines').update(patch).eq('id', id));
  }
  async deleteWine(id: string) {
    must(await this.sb.from('wines').delete().eq('id', id));
  }

  async createLot(p: Record<string, unknown>, requestId: string) {
    return must(await this.sb.rpc('create_lot', { p, p_request: requestId })) as Lot;
  }
  async updateLot(id: string, patch: Partial<Lot>) {
    must(await this.sb.from('lots').update(patch).eq('id', id));
  }
  async deleteLot(id: string) {
    must(await this.sb.from('lots').delete().eq('id', id));
  }

  async movements(lotIds: string[]) {
    if (!lotIds.length) return [] as Movement[];
    return must(await this.sb.from('movements').select('*').in('lot_id', lotIds).order('created_at', { ascending: false }).limit(500)) as Movement[];
  }
  async recordMovement(lot: string, kind: string, quantity: number, date: string | null, note: string | null, requestId: string) {
    return must(await this.sb.rpc('record_movement', { p_lot: lot, p_kind: kind, p_quantity: quantity, p_date: date, p_note: note, p_request: requestId })) as Movement;
  }
  async setLotQuantity(lot: string, quantity: number, note: string | null, requestId: string) {
    return must(await this.sb.rpc('set_lot_quantity', { p_lot: lot, p_quantity: quantity, p_note: note, p_request: requestId })) as Movement;
  }
  async reverseMovement(movement: string, requestId: string) {
    return must(await this.sb.rpc('reverse_movement', { p_movement: movement, p_request: requestId })) as Movement;
  }

  // ───────────── Prix ─────────────

  async addManualPrice(p: Pick<MarketPrice, 'wine_id' | 'volume_ml' | 'currency' | 'price_low' | 'price_high' | 'note'> & { sources: { url: string; title?: string }[] }) {
    must(await this.sb.from('market_prices').insert({ ...p, method: 'manual' }));
  }
  async deleteMarketPrice(id: string) {
    must(await this.sb.from('market_prices').delete().eq('id', id));
  }
  async priceChecks(wineId: string) {
    return must(await this.sb.from('price_checks').select('*').eq('wine_id', wineId).order('created_at', { ascending: false }).limit(5)) as PriceCheck[];
  }
  async savePriceCheck(checkId: string) {
    return must(await this.sb.rpc('save_price_check', { p_check: checkId })) as MarketPrice;
  }

  // ───────────── Amis ─────────────

  /**
   * Lien d'invitation : « discovery », « friend » (voir ma cave), ou « group » / « event » avec le groupe ou l'événement
   * visé. options : note (destinataire) ; pour « friend » : scope, lots, detail_level, access_expires_at.
   */
  async createInvite(kind: InviteKind, target: string | null = null, options: InviteOptions & { note?: string | null } = {}) {
    return must(await this.sb.rpc('create_invite', { p_kind: kind, p_target: target, p_options: options })) as {
      id: string;
      code: string;
      expires_at: string;
      kind: InviteKind;
      max_uses: number;
    };
  }
  /** Lisible sans compte : prénom de la personne qui invite, type du lien, nom du groupe ou titre et date de l'événement. */
  async inviteInfo(code: string) {
    return must(await this.sb.rpc('friend_invite_info', { p_code: code })) as {
      status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired' | 'used' | 'invalid';
      kind?: InviteKind;
      inviter_name?: string;
      target_label?: string | null;
      target_date?: string | null;
      /** Lien « voir ma cave » limité à une sélection de bouteilles. */
      selection?: boolean;
      is_self?: boolean;
      already_friends?: boolean;
    };
  }
  /** Qui a utilisé mes liens, et quand. */
  async myInviteRedemptions() {
    return (must(await this.sb.rpc('my_invite_redemptions')) ?? []) as InviteRedemption[];
  }
  async respondInvite(code: string, accept: boolean) {
    return must(await this.sb.rpc('respond_friend_invite', { p_code: code, p_accept: accept })) as {
      status: string;
      friend_id: string;
      friend_name: string;
      kind: InviteKind;
      target_id: string | null;
    };
  }
  async revokeInvite(id: string) {
    must(await this.sb.rpc('revoke_friend_invite', { p_id: id }));
  }

  // ───────────── Accès à ma cave ─────────────

  async grantCellarAccess(user: string) {
    must(await this.sb.rpc('grant_cellar_access', { p_user: user }));
  }
  /** Fermer ma cave à une personne : la relation, les groupes et les événements communs restent. */
  async revokeCellarAccess(user: string) {
    must(await this.sb.rpc('revoke_cellar_access', { p_user: user }));
  }
  /** « Retirer de mes amis » : plus aucune cave ouverte entre nous ; nous restons en contact. */
  async unfriend(user: string) {
    must(await this.sb.rpc('unfriend', { p_user: user }));
  }
  async closeCellarToEveryone() {
    return must(await this.sb.rpc('close_my_cellar_to_everyone')) as number;
  }
  async setDetailLevel(user: string, level: DetailLevel) {
    must(await this.sb.rpc('set_cellar_detail_level', { p_user: user, p_level: level }));
  }
  /** Réglages de l'accès que j'ai ouvert : toute ma cave partagée ou une sélection, date de fin (null : sans fin). */
  async setCellarAccessOptions(user: string, p: { scope?: AccessScope; expires_at?: string | null }) {
    must(await this.sb.rpc('set_cellar_access_options', { p_user: user, p }));
  }
  /** Exception pour une personne sur un de mes lots : « hide », « show », ou null pour la retirer. */
  async setCellarException(user: string, lot: string, mode: 'hide' | 'show' | null) {
    must(await this.sb.rpc('set_cellar_exception', { p_user: user, p_lot: lot, p_mode: mode }));
  }
  async cellarExceptions(user: string) {
    return must(await this.sb.from('cellar_access_exceptions').select('*').eq('viewer_id', user)) as CellarException[];
  }
  /** Mes bouteilles telles que cette personne les voit vraiment (même règle que la vue qui lui est servie). */
  async previewAs(user: string) {
    return (must(await this.sb.rpc('preview_my_cellar_as', { p_viewer: user })) ?? []) as PreviewLot[];
  }
  async relationOverview(user: string) {
    return must(await this.sb.rpc('relation_overview', { p_other: user })) as RelationOverview;
  }
  async requestCellarAccess(owner: string) {
    return must(await this.sb.rpc('request_cellar_access', { p_owner: owner })) as { status: 'requested' | 'already_open'; id?: string };
  }
  async respondAccessRequest(id: string, accept: boolean) {
    must(await this.sb.rpc('respond_cellar_access_request', { p_id: id, p_accept: accept }));
  }
  async cancelAccessRequest(id: string) {
    must(await this.sb.rpc('cancel_cellar_access_request', { p_id: id }));
  }
  async setShowSharedWines(id: string, show: boolean) {
    must(await this.sb.from('profiles').update({ show_shared_wines: show }).eq('id', id));
  }
  // ───────────── Recherche, demandes, blocage, notifications ─────────────

  async searchUsers(q: string) {
    return must(await this.sb.rpc('search_users', { p_query: q })) as UserResult[];
  }
  /** Demande de contact ; openCellar : j'ouvre aussi ma cave à cette personne dès qu'elle accepte. */
  async sendFriendRequest(to: string, openCellar = false) {
    return must(await this.sb.rpc('send_friend_request', { p_to: to, p_open_cellar: openCellar })) as {
      status: 'requested' | 'accepted' | 'already_friends';
      id?: string;
    };
  }
  async respondFriendRequest(id: string, accept: boolean) {
    return must(await this.sb.rpc('respond_friend_request', { p_id: id, p_accept: accept })) as { status: 'accepted' | 'declined' };
  }
  async cancelFriendRequest(id: string) {
    must(await this.sb.rpc('cancel_friend_request', { p_id: id }));
  }
  async blockUser(id: string) {
    must(await this.sb.rpc('block_user', { p_user: id }));
  }
  async unblockUser(id: string) {
    must(await this.sb.rpc('unblock_user', { p_user: id }));
  }
  async markNotificationsRead() {
    must(await this.sb.rpc('mark_notifications_read'));
  }
  async setDiscoverable(id: string, discoverable: boolean) {
    must(await this.sb.from('profiles').update({ discoverable }).eq('id', id));
  }

  // ───────────── Groupes ─────────────

  async createGroup(g: { name: string; emoji: string; description: string | null; photo: string | null; invite: string[] }) {
    return must(
      await this.sb.rpc('create_group', { p_name: g.name, p_emoji: g.emoji, p_description: g.description, p_photo: g.photo, p_invite: g.invite }),
    ) as { id: string };
  }
  async updateGroup(id: string, patch: Partial<Pick<MyGroup, 'name' | 'emoji' | 'description' | 'photo'>>) {
    must(await this.sb.rpc('update_group', { p_group: id, p: patch }));
  }
  async deleteGroup(id: string) {
    must(await this.sb.rpc('delete_group', { p_group: id }));
  }
  async inviteToGroup(id: string, users: string[]) {
    return must(await this.sb.rpc('invite_to_group', { p_group: id, p_users: users })) as number;
  }
  async respondGroupInvite(id: string, accept: boolean) {
    return must(await this.sb.rpc('respond_group_invite', { p_group: id, p_accept: accept })) as 'active' | 'declined';
  }
  async cancelGroupInvite(id: string, user: string) {
    must(await this.sb.rpc('cancel_group_invite', { p_group: id, p_user: user }));
  }
  async setMemberRole(id: string, user: string, role: string) {
    must(await this.sb.rpc('set_member_role', { p_group: id, p_user: user, p_role: role }));
  }
  async removeMember(id: string, user: string) {
    must(await this.sb.rpc('remove_member', { p_group: id, p_user: user }));
  }
  async leaveGroup(id: string) {
    must(await this.sb.rpc('leave_group', { p_group: id }));
  }
  async shareLotWithGroup(lot: string, group: string, share: boolean) {
    must(await this.sb.rpc('share_lot_with_group', { p_lot: lot, p_group: group, p_share: share }));
  }
  /** Nombre de bouteilles du lot mises à disposition du groupe (valeur finale ; 0 = tout reprendre). */
  async allocateToGroup(lot: string, group: string, quantity: number) {
    return must(await this.sb.rpc('allocate_to_group', { p_lot: lot, p_group: group, p_quantity: quantity })) as GroupShare;
  }
  /** J'ouvre des bouteilles que j'avais mises à disposition du groupe. Clé d'idempotence : une seule fois. */
  async consumeFromGroup(lot: string, group: string, quantity: number, date: string | null, note: string | null, requestId: string) {
    return must(
      await this.sb.rpc('consume_from_group', { p_lot: lot, p_group: group, p_quantity: quantity, p_date: date, p_note: note, p_request: requestId }),
    ) as Movement;
  }
  async groupMembers(id: string) {
    return must(await this.sb.rpc('group_members_list', { p_group: id })) as GroupMember[];
  }
  async groupLots(id: string) {
    return must(await this.sb.rpc('group_lots', { p_group: id })) as GroupLot[];
  }
  /** Notes de dégustation partagées avec le groupe. */
  async groupNotes(id: string) {
    return must(await this.sb.rpc('group_notes', { p_group: id })) as GroupNote[];
  }
  /** Envies communes du groupe, les plus suivies d'abord. */
  // Alerte de baisse de prix : un vin suivi au plus.
  async priceWatch() {
    return must(await this.sb.from('price_watches').select('*').maybeSingle()) as PriceWatch | null;
  }
  async setPriceWatch(wine: string | null, volume: number | null) {
    must(await this.sb.rpc('set_price_watch', { p_wine: wine, p_volume: volume }));
  }

  // Mode soirée
  async eventLiveState(event: string) {
    return must(await this.sb.rpc('event_live_state', { p_event: event })) as EventLiveState | null;
  }
  async startEventLive(event: string, blind: boolean) {
    must(await this.sb.rpc('start_event_live', { p_event: event, p_blind: blind }));
  }
  async serveEventWine(event: string, wine: string) {
    must(await this.sb.rpc('event_live_serve', { p_event: event, p_wine: wine }));
  }
  async revealEventWine(event: string, wine: string) {
    must(await this.sb.rpc('event_live_reveal', { p_event: event, p_wine: wine }));
  }
  async endEventLive(event: string) {
    must(await this.sb.rpc('end_event_live', { p_event: event }));
  }
  async postEventMessage(event: string, body: string) {
    must(await this.sb.rpc('post_event_message', { p_event: event, p_body: body }));
  }
  async voteEventWine(wine: string, rating: number | null) {
    must(await this.sb.rpc('vote_event_wine', { p_wine: wine, p_rating: rating }));
  }

  // Achats groupés (aucun paiement dans l'application)
  async groupPurchases(group: string) {
    return must(await this.sb.rpc('group_purchases_list', { p_group: group })) as GroupPurchase[];
  }
  async createGroupPurchase(group: string, p: { title: string; budget: number | null; note: string | null }) {
    must(await this.sb.rpc('create_group_purchase', { p_group: group, p }));
  }
  async addGroupPurchaseItem(purchase: string, p: { wine_name: string; producer: string | null; vintage: number | null; color: string | null; unit_price: number; bottles: number }) {
    must(await this.sb.rpc('add_group_purchase_item', { p_purchase: purchase, p }));
  }
  async removeGroupPurchaseItem(item: string) {
    must(await this.sb.rpc('remove_group_purchase_item', { p_item: item }));
  }
  async setPurchasePart(item: string, bottles: number) {
    must(await this.sb.rpc('set_purchase_part', { p_item: item, p_bottles: bottles }));
  }
  async validatePurchaseParts(purchase: string, on: boolean) {
    must(await this.sb.rpc('validate_purchase_parts', { p_purchase: purchase, p_on: on }));
  }
  async setGroupPurchaseStatus(purchase: string, status: GroupPurchase['status']) {
    must(await this.sb.rpc('set_group_purchase_status', { p_purchase: purchase, p_status: status }));
  }

  async groupWishes(id: string) {
    return must(await this.sb.rpc('group_wishes_list', { p_group: id })) as GroupWish[];
  }
  async addGroupWish(id: string, p: { wine_name: string; producer: string | null; vintage: number | null; color: string | null; note: string | null }) {
    must(await this.sb.rpc('add_group_wish', { p_group: id, p }));
  }
  async voteGroupWish(wish: string, on: boolean) {
    must(await this.sb.rpc('vote_group_wish', { p_wish: wish, p_on: on }));
  }
  async deleteGroupWish(wish: string) {
    must(await this.sb.rpc('delete_group_wish', { p_wish: wish }));
  }
  async groupActivity(id: string) {
    return must(await this.sb.from('group_activity').select('*').eq('group_id', id).order('created_at', { ascending: false }).limit(100)) as GroupActivity[];
  }

  async removeFriend(id: string) {
    must(await this.sb.rpc('remove_friend', { p_friend: id }));
  }
  async sharedLots(owner: string | null = null) {
    return (must(await this.sb.rpc('shared_lots', { p_owner: owner })) ?? []) as SharedLot[];
  }

  // ───────────── Événements ─────────────

  /**
   * Après un changement d'événement : demande l'envoi immédiat vers les agendas Nous des participants liés
   * (sinon la tâche planifiée s'en charge dans la minute). Regroupé, sans attendre la réponse, sans effet en cas d'échec.
   */
  private nousTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeNous() {
    if (this.nousTimer) clearTimeout(this.nousTimer);
    this.nousTimer = setTimeout(() => {
      this.nousTimer = null;
      void this.ai('nous_flush').catch(() => undefined);
    }, 1500);
  }

  async createEvent(p: Record<string, unknown>, guests: string[]) {
    const ev = must(await this.sb.rpc('create_event', { p, p_guests: guests })) as CaveEvent;
    this.nudgeNous();
    return ev;
  }
  async updateEvent(id: string, patch: Partial<CaveEvent>) {
    must(await this.sb.from('events').update(patch).eq('id', id));
    this.nudgeNous();
  }
  async inviteToEvent(id: string, guests: string[]) {
    must(await this.sb.rpc('invite_to_event', { p_event: id, p_guests: guests }));
    this.nudgeNous();
  }
  async respondEvent(id: string, rsvp: string) {
    must(await this.sb.rpc('respond_event', { p_event: id, p_rsvp: rsvp }));
    this.nudgeNous();
  }
  async removeParticipant(id: string, user: string) {
    must(await this.sb.rpc('remove_participant', { p_event: id, p_user: user }));
    this.nudgeNous();
  }
  async cancelEvent(id: string) {
    must(await this.sb.rpc('cancel_event', { p_event: id }));
    this.nudgeNous();
  }
  async deleteEvent(id: string) {
    must(await this.sb.rpc('delete_event', { p_event: id }));
    this.nudgeNous();
  }
  async closeEvent(id: string) {
    must(await this.sb.rpc('close_event', { p_event: id }));
    this.nudgeNous();
  }
  async eventDetail(id: string, planned: boolean): Promise<EventDetail> {
    const [participants, dishes, wines, suggestable, tastings] = await Promise.all([
      this.sb.from('event_participants').select('*').eq('event_id', id).then(must),
      this.sb.from('event_dishes').select('*').eq('event_id', id).order('position').order('created_at').then(must),
      this.sb.from('event_wines').select('*').eq('event_id', id).order('created_at').then(must),
      planned ? this.sb.rpc('event_suggestable_lots', { p_event: id }).then(must) : Promise.resolve([]),
      // Notes partagées des autres participants : sans leur prix payé (fonction de la base).
      this.sb.rpc('event_tastings', { p_event: id }).then(must),
    ]);
    return {
      participants: participants as Participant[],
      dishes: dishes as Dish[],
      wines: wines as EventWine[],
      suggestable: (suggestable ?? []) as SuggestableLot[],
      tastings: tastings as Tasting[],
    };
  }
  async proposeEventWine(event: string, lot: string, quantity: number, note: string | null, bring: boolean, requestId: string) {
    const w = must(
      await this.sb.rpc('propose_event_wine', { p_event: event, p_lot: lot, p_quantity: quantity, p_note: note, p_bring: bring, p_request: requestId }),
    ) as EventWine;
    this.nudgeNous();
    return w;
  }
  async confirmEventWine(id: string, quantity: number | null) {
    const w = must(await this.sb.rpc('confirm_event_wine', { p_id: id, p_quantity: quantity })) as EventWine;
    this.nudgeNous();
    return w;
  }
  async declineEventWine(id: string) {
    must(await this.sb.rpc('decline_event_wine', { p_id: id }));
    this.nudgeNous();
  }
  async withdrawEventWine(id: string) {
    must(await this.sb.rpc('withdraw_event_wine', { p_id: id }));
    this.nudgeNous();
  }
  async confirmConsumption(id: string, consumed: number, requestId: string) {
    return must(await this.sb.rpc('confirm_event_consumption', { p_id: id, p_consumed: consumed, p_request: requestId })) as EventWine;
  }
  async setServiceOrder(event: string, order: string[]) {
    must(await this.sb.rpc('set_service_order', { p_event: event, p_order: order }));
  }
  async addDish(d: Pick<Dish, 'event_id' | 'course' | 'name' | 'position'>) {
    must(await this.sb.from('event_dishes').insert(d));
  }
  async deleteDish(id: string) {
    must(await this.sb.from('event_dishes').delete().eq('id', id));
  }

  // ───────────── Carnet ─────────────

  async createTasting(p: Record<string, unknown>, consumeLot: string | null, requestId: string) {
    return must(await this.sb.rpc('create_tasting', { p, p_consume_lot: consumeLot, p_request: requestId })) as Tasting;
  }
  async updateTasting(id: string, patch: Partial<Tasting>) {
    must(await this.sb.from('tastings').update(patch).eq('id', id));
  }
  async deleteTasting(id: string) {
    must(await this.sb.from('tastings').delete().eq('id', id));
  }
  async addWish(w: Partial<WishItem> & { wine_name: string }) {
    must(await this.sb.from('wishlist').insert(w));
  }
  async updateWish(id: string, patch: Partial<WishItem>) {
    must(await this.sb.from('wishlist').update(patch).eq('id', id));
  }
  async deleteWish(id: string) {
    must(await this.sb.from('wishlist').delete().eq('id', id));
  }

  // ───────────── Photos (stockage privé) ─────────────

  async uploadPhoto(userId: string, blob: Blob) {
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}/${newId()}.${ext}`;
    const { error } = await this.sb.storage.from('photos').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) throw error;
    return path;
  }
  /** Copie d'une de mes photos (nouveau chemin dans mon dossier). */
  async copyPhoto(userId: string, path: string) {
    const { data, error } = await this.sb.storage.from('photos').download(path);
    if (error || !data) throw error ?? new Error('not_found');
    return this.uploadPhoto(userId, data.type ? data : new Blob([data], { type: 'image/jpeg' }));
  }
  async signedUrls(paths: string[]) {
    if (!paths.length) return new Map<string, string>();
    const { data, error } = await this.sb.storage.from('photos').createSignedUrls(paths, 3600);
    if (error) throw error;
    const map = new Map<string, string>();
    for (const d of data ?? []) if (d.signedUrl && d.path) map.set(d.path, d.signedUrl);
    return map;
  }
  async removePhotos(paths: string[]) {
    if (paths.length) await this.sb.storage.from('photos').remove(paths);
  }
  /**
   * Photo de profil : nouvelle photo (déjà recadrée) ou aucune (null). L'ancienne est supprimée ensuite ; si cette
   * suppression échoue, la purge mensuelle des photos inutiles s'en charge.
   */
  async setAvatar(userId: string, blob: Blob | null, previous: string | null | undefined) {
    let path: string | null = null;
    if (blob) {
      path = `${userId}/avatar-${newId()}.jpg`;
      const { error } = await this.sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
    }
    const saved = await this.sb.from('profiles').update({ avatar_photo: path }).eq('id', userId);
    if (saved.error) {
      if (path) await this.removePhotos([path]).catch(() => undefined);
      throw saved.error;
    }
    if (previous && previous !== path) await this.removePhotos([previous]).catch(() => undefined);
    return path;
  }

  // ───────────── Scanner avant d'acheter ─────────────

  async scans() {
    return must(await this.sb.from('scans').select('*').order('created_at', { ascending: false }).limit(100)) as Scan[];
  }
  async scan(id: string) {
    return must(await this.sb.from('scans').select('*').eq('id', id).maybeSingle()) as Scan | null;
  }
  /** Analyse saisie à la main (assistant indisponible) : sans lecture de Lia. */
  async createManualScan(row: Pick<Scan, 'photos' | 'wine'> & { barcode?: string | null; visit_id?: string | null }) {
    return must(await this.sb.from('scans').insert(row).select('*').single()) as Scan;
  }
  async updateScan(id: string, patch: Partial<Pick<Scan, 'status' | 'barcode' | 'wine' | 'store_price' | 'currency' | 'store_name' | 'price_confirmed' | 'budget' | 'visit_id'>>) {
    return must(await this.sb.from('scans').update(patch).eq('id', id).select('*').single()) as Scan;
  }
  /** Supprime des analyses et leurs photos. */
  async deleteScans(list: Scan[]) {
    if (!list.length) return;
    await this.removePhotos(list.flatMap((s) => s.photos.map((p) => p.path))).catch(() => undefined);
    must(await this.sb.from('scans').delete().in('id', list.map((s) => s.id)));
  }
  async visits() {
    return must(await this.sb.from('scan_visits').select('*').order('created_at', { ascending: false }).limit(50)) as ScanVisit[];
  }
  async visit(id: string) {
    return must(await this.sb.from('scan_visits').select('*').eq('id', id).maybeSingle()) as ScanVisit | null;
  }
  async visitScans(id: string) {
    return must(await this.sb.from('scans').select('*').eq('visit_id', id).order('created_at').limit(50)) as Scan[];
  }
  async createVisit(row: Partial<Pick<ScanVisit, 'store_name' | 'budget' | 'occasion'>>) {
    return must(await this.sb.from('scan_visits').insert(row).select('*').single()) as ScanVisit;
  }
  async updateVisit(id: string, patch: Partial<Pick<ScanVisit, 'store_name' | 'budget' | 'occasion'>>) {
    return must(await this.sb.from('scan_visits').update(patch).eq('id', id).select('*').single()) as ScanVisit;
  }
  /** Supprime la visite seulement (ses analyses restent dans l'historique). */
  async deleteVisit(id: string) {
    must(await this.sb.from('scan_visits').delete().eq('id', id));
  }
  async scanStatus() {
    return must(await this.sb.rpc('my_scan_status')) as { used: number; limit: number; retention_days: number };
  }

  // ───────────── Assistant (fonction serveur) ─────────────

  // ───────────── Notifications push ─────────────

  /** Action de la fonction serveur hors assistant : l'échec devient une erreur. */
  private async fn(action: string, body: Record<string, unknown> = {}) {
    const r = await this.ai(action, body);
    if (!r.ok) throw new AppError(r.message, r.code);
    return r;
  }

  /** Clé publique du serveur (VAPID), donnée au navigateur pour l'abonnement. */
  async pushKey(): Promise<string> {
    return String((await this.fn('push_key')).public_key);
  }

  async pushSubscribe(device: DeviceSubscription, label: string) {
    await this.fn('push_subscribe', { ...device, label });
  }

  /** Notification d'essai vers tous mes appareils. */
  async pushTest() {
    return (await this.fn('push_test')) as unknown as { devices: number; sent: number; gone: number; failed: number };
  }

  async myPushDevices(): Promise<PushDevice[]> {
    return must(await this.sb.rpc('my_push_devices')) as PushDevice[];
  }

  async removePushDevice(id: string) {
    must(await this.sb.rpc('remove_push_device', { p_id: id }));
  }

  async removePushEndpoint(endpoint: string) {
    must(await this.sb.rpc('remove_push_endpoint', { p_endpoint: endpoint }));
  }

  async ai(action: string, body: Record<string, unknown> = {}): Promise<AiReply> {
    const { data, error } = await this.sb.functions.invoke('cave-api', { body: { action, ...body } });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
      if (payload && payload.ok === false) return payload as AiReply;
      if (ctx?.status === 404) return { ok: false, code: 'ai_not_configured', message: AI_MESSAGES.ai_not_configured };
      return { ok: false, code: 'service_unavailable', message: 'Le serveur de l’assistant ne répond pas. Réessayez plus tard ; le reste de l’application fonctionne normalement.' };
    }
    return data as AiReply;
  }
  async conversations() {
    return must(await this.sb.from('ai_conversations').select('*').order('updated_at', { ascending: false }).limit(50)) as Conversation[];
  }
  async conversationMessages(id: string) {
    return must(await this.sb.from('ai_messages').select('*').eq('conversation_id', id).order('created_at').limit(200)) as AiMessage[];
  }
  async deleteConversation(id: string) {
    must(await this.sb.from('ai_conversations').delete().eq('id', id));
  }

  // ───────────── Documents légaux, consentements, export de mes données ─────────────

  /** Dernière version publiée de chaque document (lisible sans compte). */
  async legalCurrent() {
    return (must(await this.sb.rpc('legal_current')) ?? []) as LegalDoc[];
  }
  async legalPending() {
    return (must(await this.sb.rpc('legal_pending')) ?? []) as LegalPending[];
  }
  async legalAccept(documentId: string, action: 'acceptation' | 'prise_de_connaissance', context: 'inscription' | 'connexion' | 'reglages') {
    must(await this.sb.rpc('legal_accept', { p_document: documentId, p_action: action, p_context: context }));
  }
  async myLegalHistory() {
    return must(await this.sb.rpc('my_legal_history')) as LegalHistory;
  }
  /** Toutes mes données (format « cave-export-v1 ») ; `photos` : les fichiers de mon dossier, à télécharger à part. */
  async exportMyData() {
    const data = must(await this.sb.rpc('export_my_data')) as Record<string, unknown> & { photos: string[] };
    // Profil de goûts (lot 1 de Cave & Amis 2.0) : lu avec mes droits et ajouté à l'export.
    const { data: gouts, error } = await this.sb.from('taste_profiles').select('*').maybeSingle();
    if (error) throw error;
    return { ...data, gouts: gouts ?? null };
  }

  // ───────────── Profil de goûts ─────────────
  async myTaste(userId: string) {
    const { data, error } = await this.sb.from('taste_profiles').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data as TasteProfile | null;
  }
  async saveTaste(userId: string, patch: Partial<Pick<TasteProfile, 'likes' | 'dislikes' | 'ignored' | 'budget_max' | 'note'>>) {
    // Mise à jour, sinon création (la colonne user_id n'est pas modifiable : pas d'upsert).
    const updated = must(await this.sb.from('taste_profiles').update(patch).eq('user_id', userId).select('user_id')) as unknown[];
    if (updated.length) return;
    const { error } = await this.sb.from('taste_profiles').insert({ user_id: userId, ...patch });
    // Créée entre-temps (autre onglet) : on la met à jour.
    if (error && error.code === '23505') must(await this.sb.from('taste_profiles').update(patch).eq('user_id', userId));
    else if (error) throw error;
  }
  async deleteTaste(userId: string) {
    must(await this.sb.from('taste_profiles').delete().eq('user_id', userId));
  }
  async photoBlob(path: string) {
    const { data, error } = await this.sb.storage.from('photos').download(path);
    if (error || !data) throw error ?? new Error('not_found');
    return data;
  }
  async adminLegalPublish(kind: LegalKind, title: string, content: string, summary: string, requiresAcceptance: boolean) {
    return must(
      await this.sb.rpc('admin_legal_publish', { p_kind: kind, p_title: title, p_content: content, p_summary: summary, p_requires_acceptance: requiresAcceptance }),
    ) as string;
  }
  async adminLegalStats() {
    return (must(await this.sb.rpc('admin_legal_stats')) ?? []) as LegalStats[];
  }

  // ───────────── Administration ─────────────

  async adminOverview() {
    return must(await this.sb.rpc('admin_ai_overview')) as AdminOverview;
  }
  async adminUpdateSettings(p: Record<string, unknown>) {
    must(await this.sb.rpc('admin_update_ai_settings', { p }));
  }
  async adminSetLimits(user: string, daily: number | null, monthly: number | null, blocked: boolean, reset = false) {
    must(await this.sb.rpc('admin_set_user_limits', { p_user: user, p_daily: daily, p_monthly: monthly, p_blocked: blocked, p_reset: reset }));
  }
  /** Journal des actions de l'administrateur (12 mois), le plus récent d'abord. */
  async adminJournal(limit = 100) {
    return (must(await this.sb.rpc('admin_audit_journal', { p_limit: limit })) ?? []) as AdminJournalEntry[];
  }
}

export type AdminJournalEntry = {
  at: string;
  action: 'publication_document' | 'reglages_assistant' | 'limites_compte';
  target_name: string;
  details: Record<string, unknown>;
};

export type AdminOverview = {
  settings: {
    enabled: boolean;
    model: string;
    effort: 'low' | 'medium' | 'high';
    max_output_tokens: number;
    max_input_chars: number;
    max_image_bytes: number;
    max_api_calls: number;
    history_messages: number;
    web_search_enabled: boolean;
    max_web_searches: number;
    web_search_token_allowance: number;
    web_search_price_per_1000: number;
    monthly_budget_usd: number;
    alert_pct: number;
    default_daily_requests: number;
    default_monthly_user_usd: number;
    rate_per_minute: number;
    max_concurrent_per_user: number;
    /** Scanner avant d'acheter : modèle (null = celui de l'assistant), analyses par jour, conservation (jours). */
    scan_model: string | null;
    scan_daily_limit: number;
    scan_retention_days: number;
    prices: Record<string, { input: number; output: number; cache_write?: number; cache_read?: number }>;
    available_models: { id: string; display_name: string }[];
    key_status: string;
    key_checked_at: string | null;
    updated_at: string;
  };
  month: { cost_usd: number; reserved_usd: number; requests: number; failed: number; input_tokens: number; output_tokens: number; web_searches: number; in_flight: number };
  budget_pct: number;
  users: {
    user_id: string;
    display_name: string;
    email: string | null;
    is_admin: boolean;
    requests_today: number;
    month_requests: number;
    month_cost_usd: number;
    daily_limit: number;
    monthly_limit_usd: number;
    blocked: boolean;
    custom: boolean;
  }[];
  errors: { created_at: string; action: string | null; code: string; detail: string | null; model: string | null; user_name: string | null }[];
  days: { day: string; cost_usd: number; requests: number }[];
};
