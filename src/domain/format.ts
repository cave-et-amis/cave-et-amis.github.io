/** Mise en forme française : montants, dates, quantités. */

export function money(value: number | null | undefined, currency = 'EUR') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2 }).format(Number(value));
}

export function moneyRange(low: number, high: number, currency = 'EUR') {
  return Math.round(low * 100) === Math.round(high * 100) ? money(low, currency) : `${money(low, currency)} – ${money(high, currency)}`;
}

/** « de Bruno », « d’Alice » : élision devant une voyelle ou un h. */
export function deName(name: string) {
  return /^[aeiouyhàâäéèêëîïôöùûü]/i.test(name) ? `d’${name}` : `de ${name}`;
}

export function bottles(n: number) {
  return `${n} bouteille${Math.abs(n) > 1 ? 's' : ''}`;
}

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' });
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

/** Date seule (« 2026-10-19 ») ou horodatage. */
export function dateLong(d: string | Date) {
  return DAY.format(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d));
}

export function dateShort(d: string | Date) {
  return DAY_SHORT.format(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d));
}

export function eventDate(d: string) {
  const date = new Date(d);
  const w = WEEKDAY.format(date);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} à ${TIME.format(date).replace(':', ' h ')}`;
}

/** Date du jour en France (AAAA-MM-JJ). */
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function currentYear(now = new Date()) {
  return Number(todayIso(now).slice(0, 4));
}

/** Fin de la journée choisie (AAAA-MM-JJ, heure de l'appareil) : la date de fin d'un accès est incluse. */
export function endOfDay(day: string) {
  return new Date(`${day}T23:59:00`).toISOString();
}

/** Le jour (AAAA-MM-JJ, heure de l'appareil) d'un instant : valeur d'un <input type="date">, réciproque de endOfDay. */
export function localDay(d = new Date()) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}

/** Valeur pour <input type="datetime-local"> à partir d'un horodatage (heure de Paris). */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Inverse de toLocalInput : interprète l'heure saisie comme l'heure de Paris. */
export function fromLocalInput(value: string) {
  const [date, time] = value.split('T');
  const guess = new Date(`${date}T${time}:00Z`);
  const shown = toLocalInput(guess.toISOString());
  const diff = new Date(`${shown}:00Z`).getTime() - guess.getTime();
  return new Date(guess.getTime() - diff).toISOString();
}

export function relativeDays(iso: string, now = new Date()) {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const t = new Date(`${todayIso(now)}T12:00:00`);
  const days = Math.round((d.getTime() - t.getTime()) / 86400_000);
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  if (days === -1) return 'hier';
  if (days > 1) return `dans ${days} jours`;
  return `il y a ${-days} jours`;
}

export function parseNumber(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
