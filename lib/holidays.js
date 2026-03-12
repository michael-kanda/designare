// lib/holidays.js - Österreichische Feiertage + Spezial-Tage
// Rein offline, keine API nötig

/**
 * Gaußsche Osterformel – berechnet Ostersonntag für ein gegebenes Jahr.
 * @param {number} year
 * @returns {Date} Ostersonntag
 */
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=März, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

/**
 * Hilfsfunktion: Datum um n Tage verschieben
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Formatiert ein Datum als "MM-DD" String für Vergleiche
 */
function toKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}`;
}

/**
 * Gibt alle Feiertage und Spezial-Tage für ein Jahr zurück.
 * @param {number} year
 * @returns {Map<string, {name: string, emoji: string, vibe: string}>}
 */
function getHolidaysForYear(year) {
  const easter = getEasterSunday(year);
  const holidays = new Map();

  // ── Fixe gesetzliche Feiertage ──
  const fixed = [
    { date: '01-01', name: 'Neujahr', emoji: '🎆', vibe: 'Frohes Neues! Neues Jahr, neue Projekte – oder erstmal ausschlafen?' },
    { date: '01-06', name: 'Heilige Drei Könige', emoji: '👑', vibe: 'Dreikönigstag – die Feiertage klingen aus, langsam geht\'s wieder los.' },
    { date: '05-01', name: 'Staatsfeiertag', emoji: '🇦🇹', vibe: 'Tag der Arbeit – oder der Nicht-Arbeit. Genieß den freien Tag!' },
    { date: '08-15', name: 'Mariä Himmelfahrt', emoji: '⛪', vibe: 'Mariä Himmelfahrt – mitten im Sommer, perfekter Feiertag.' },
    { date: '10-26', name: 'Nationalfeiertag', emoji: '🇦🇹', vibe: 'Österreichischer Nationalfeiertag! Auf die Neutralität und ein schönes Land.' },
    { date: '11-01', name: 'Allerheiligen', emoji: '🕯️', vibe: 'Allerheiligen – ein ruhiger, besinnlicher Tag.' },
    { date: '12-08', name: 'Mariä Empfängnis', emoji: '⛪', vibe: 'Mariä Empfängnis – mitten im Advent, die Weihnachtszeit läuft.' },
    { date: '12-25', name: 'Christtag', emoji: '🎄', vibe: 'Frohe Weihnachten! Entspann dich und genieß den Tag.' },
    { date: '12-26', name: 'Stefanitag', emoji: '🎄', vibe: 'Stefanitag – zweiter Weihnachtstag, noch ein Tag zum Durchschnaufen.' },
  ];

  for (const h of fixed) {
    holidays.set(h.date, { name: h.name, emoji: h.emoji, vibe: h.vibe });
  }

  // ── Bewegliche Feiertage (abhängig von Ostern) ──
  const movable = [
    { offset: -2, name: 'Karfreitag', emoji: '✝️', vibe: 'Karfreitag – ein stiller Tag. Ruhiger Ton, keine Business-Pushs.' },
    { offset: 0, name: 'Ostersonntag', emoji: '🐣', vibe: 'Frohe Ostern! Eiersuche schon erledigt?' },
    { offset: 1, name: 'Ostermontag', emoji: '🐣', vibe: 'Ostermontag – der gemütliche Ausklang vom Osterwochenende.' },
    { offset: 39, name: 'Christi Himmelfahrt', emoji: '☁️', vibe: 'Christi Himmelfahrt – Fenstertag-Alarm!' },
    { offset: 49, name: 'Pfingstsonntag', emoji: '🕊️', vibe: 'Pfingsten! Langes Wochenende genießen.' },
    { offset: 50, name: 'Pfingstmontag', emoji: '🕊️', vibe: 'Pfingstmontag – noch ein Tag Pause.' },
    { offset: 60, name: 'Fronleichnam', emoji: '⛪', vibe: 'Fronleichnam – wieder ein Fenstertag-Kandidat.' },
  ];

  for (const h of movable) {
    const date = addDays(easter, h.offset);
    holidays.set(toKey(date), { name: h.name, emoji: h.emoji, vibe: h.vibe });
  }

  // ── Inoffizielle / Spezial-Tage (kein Feiertag, aber Smalltalk-Material) ──
  const specials = [
    { date: '02-14', name: 'Valentinstag', emoji: '💕', vibe: 'Valentinstag – ob romantisch oder anti-romantisch, Evita hat für beides Verständnis.' },
    { date: '12-24', name: 'Heiligabend', emoji: '🎄', vibe: 'Heiligabend! Heute Abend ist Bescherung – kurz und herzlich, niemand will jetzt eine Textwand.' },
    { date: '12-31', name: 'Silvester', emoji: '🎆', vibe: 'Silvester! Der letzte Tag des Jahres – auf ein gutes neues!' },
    { date: '10-31', name: 'Halloween', emoji: '🎃', vibe: 'Happy Halloween! Keine Angst, hier gibt\'s nur freundliche Bots.' },
  ];

  for (const s of specials) {
    if (!holidays.has(s.date)) {
      holidays.set(s.date, { name: s.name, emoji: s.emoji, vibe: s.vibe });
    }
  }

  return holidays;
}

/**
 * Prüft ob heute ein Feiertag/Spezial-Tag ist.
 * @returns {{ name: string, emoji: string, vibe: string } | null}
 */
export function getTodayHoliday() {
  const now = new Date();
  // Wien-Zeitzone berücksichtigen
  const vienna = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
  const year = vienna.getFullYear();
  const key = toKey(vienna);

  const holidays = getHolidaysForYear(year);
  return holidays.get(key) || null;
}

/**
 * Gibt den nächsten anstehenden Feiertag zurück (für proaktive Erwähnung).
 * @returns {{ name: string, daysUntil: number } | null}
 */
export function getNextHoliday() {
  const now = new Date();
  const vienna = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Vienna' }));
  const year = vienna.getFullYear();

  // Feiertage dieses + nächstes Jahr (für Dezember→Januar)
  const allHolidays = [
    ...Array.from(getHolidaysForYear(year).entries()).map(([key, val]) => ({
      date: new Date(year, parseInt(key.split('-')[0]) - 1, parseInt(key.split('-')[1])),
      ...val
    })),
    ...Array.from(getHolidaysForYear(year + 1).entries()).map(([key, val]) => ({
      date: new Date(year + 1, parseInt(key.split('-')[0]) - 1, parseInt(key.split('-')[1])),
      ...val
    }))
  ];

  // Nur gesetzliche Feiertage (keine Spezial-Tage) für "nächster Feiertag"
  const gesetzlich = allHolidays.filter(h =>
    !['Valentinstag', 'Halloween', 'Silvester', 'Heiligabend', 'Karfreitag'].includes(h.name)
  );

  const today = new Date(vienna.getFullYear(), vienna.getMonth(), vienna.getDate());

  let closest = null;
  let minDays = Infinity;

  for (const h of gesetzlich) {
    const diff = Math.ceil((h.date - today) / (1000 * 60 * 60 * 24));
    if (diff > 0 && diff < minDays) {
      minDays = diff;
      closest = { name: h.name, daysUntil: diff };
    }
  }

  return closest;
}
