/**
 * Documents légaux, preuves et consentements (modèle commun avec Cocon) : types, titres, règles de publication, et les
 * durées de conservation validées le 26/10/2026 (les mêmes que les purges de la base).
 */
export type LegalKind = 'cgu' | 'confidentialite' | 'mentions' | 'cookies';

export const LEGAL_KINDS: LegalKind[] = ['cgu', 'confidentialite', 'mentions', 'cookies'];

export const LEGAL_TITLES: Record<LegalKind, string> = {
  cgu: 'Conditions d’utilisation',
  confidentialite: 'Politique de confidentialité',
  mentions: 'Mentions légales',
  cookies: 'Cookies et stockage sur votre appareil',
};

export function isLegalKind(v: unknown): v is LegalKind {
  return typeof v === 'string' && (LEGAL_KINDS as string[]).includes(v);
}

export type LegalDoc = {
  id: string;
  kind: LegalKind;
  version: number;
  title: string;
  content: string;
  content_sha256: string;
  summary: string;
  requires_acceptance: boolean;
  published_at: string;
};

/** « acceptation » : à accepter avant de continuer ; « information » : nouvelle version à lire. */
export type LegalPending = { document_id: string; kind: LegalKind; version: number; title: string; summary: string; mode: 'acceptation' | 'information' };

export type LegalHistory = {
  acceptances: { kind: LegalKind; version: number; title: string; action: 'acceptation' | 'prise_de_connaissance'; context: string; at: string }[];
  consents: { purpose: string; granted: boolean; at: string; context: string; document_version: number | null }[];
  current: Record<string, boolean>;
};

export type LegalStats = {
  document_id: string;
  kind: LegalKind;
  version: number;
  title: string;
  requires_acceptance: boolean;
  published_at: string;
  acceptances: number;
  acknowledgments: number;
};

/** Âge minimum pour utiliser l'application (vin) : choix du 26/10/2026, le même que Cocon. */
export const MIN_AGE = 18;

/**
 * Emplacements à compléter ou points à faire valider par un juriste : la base refuse de publier un document qui en
 * contient encore (même règle que admin_legal_publish).
 */
export function legalPlaceholders(text: string): string[] {
  return [...text.matchAll(/\[À (?:COMPLÉTER|VALIDER)[^\]\n]*\]?/g)].map((m) => m[0]);
}

export const CONSENT_LABELS: Record<string, string> = {
  recherche_amis: 'Apparaître dans la recherche d’amis',
  liaison_nous: 'Agenda Nous relié',
};

export const ACTION_LABELS: Record<LegalHistory['acceptances'][number]['action'], string> = {
  acceptation: 'Acceptées',
  prise_de_connaissance: 'Lue',
};

export const CONTEXT_LABELS: Record<string, string> = {
  inscription: 'à l’inscription',
  connexion: 'à la connexion',
  reglages: 'dans les réglages',
  fonction: 'en utilisant la fonction',
};

/** Durées de conservation (validées le 26/10/2026), appliquées par les purges automatiques. */
export const RETENTION: { data: string; duration: string }[] = [
  { data: 'Compte, caves, vins, carnet, contacts, groupes, événements', duration: 'tant que le compte existe' },
  { data: 'Conversations avec Lia', duration: '12 mois après le dernier message (ou plus tôt si vous les supprimez)' },
  { data: 'Journaux d’usage de l’assistant (quotas, coûts)', duration: '13 mois' },
  { data: 'Journaux d’erreurs techniques', duration: '3 mois' },
  { data: 'Compteurs des limites d’utilisation (heure de quelques actions sans IA)', duration: '2 jours au plus' },
  { data: 'Relevés de prix', duration: '24 mois' },
  { data: 'Liens d’invitation expirés ou annulés', duration: '90 jours' },
  { data: 'Demandes de contact ou d’accès refusées', duration: '6 mois' },
  { data: 'Analyses et visites du scanner', duration: '30 jours' },
  { data: 'Appareils de notification qui ne répondent plus', duration: '90 jours' },
  { data: 'Photos qui ne servent plus', duration: 'effacées chaque mois' },
  { data: 'Preuves d’acceptation des conditions et historique des consentements', duration: 'durée du compte, puis 5 ans' },
];
