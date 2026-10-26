// Configuration PUBLIQUE de Cave & Amis (adresse du projet Supabase et clé publique).
// Remplacée à l'export par config.production.js s'il existe. Jamais de clé secrète (Supabase, Turnstile) ni de clé Anthropic ici.
window.CAVE_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseKey: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx',
  // Facultatif : clé de SITE Cloudflare Turnstile (contrôle anti-robots). Vide : pas de contrôle. Puis refaire l'export.
  turnstileSiteKey: '',
};
