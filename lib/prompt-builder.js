// lib/prompt-builder.js - Dynamischer System-Prompt für Evita
// Baut den Prompt aus Zeit, Memory, Wetter, Feiertage, News, RAG-Kontext zusammen
// NEU: Intent-Hint + turnCount für präzisere Steuerung
import { getTimeSinceText } from './memory-service.js';
import { MAX_EMAILS_PER_SESSION } from './email-service.js';
import { getTodayHoliday, getNextHoliday } from './holidays.js';

/**
 * Baut den kompletten System-Prompt zusammen.
 * @param {Object} params
 * @param {boolean} params.isReturningUser
 * @param {string|null} params.knownName
 * @param {number} params.visitCount
 * @param {string|null} params.lastVisit
 * @param {string[]} params.previousTopics
 * @param {number} params.emailsSent
 * @param {string|null} params.currentPage
 * @param {string} params.additionalContext - RAG-Kontext
 * @param {Array<{url: string, title: string}>} params.availableLinks
 * @param {string} [params.weatherContext] - Wetter-Kontext (von getWeatherContext())
 * @param {string} [params.newsContext] - News-Briefing (von getNewsContext())
 * @param {string} [params.intentHint] - NEU: Intent-basierter Hint
 * @param {number} [params.turnCount] - NEU: Turn-Zähler aus Redis
 * @returns {string} Fertiger System-Prompt
 */
export function buildSystemPrompt({
  isReturningUser,
  knownName,
  visitCount,
  lastVisit,
  previousTopics,
  emailsSent,
  currentPage,
  additionalContext,
  availableLinks,
  isFirstMessage = false,
  weatherContext = '',
  newsContext = '',
  intentHint = '',
  turnCount = 0
}) {
  // ── Zeitkontext (Wien) ──
  const today = new Date();
  const formattedDate = today.toLocaleDateString('de-AT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/Vienna'
  });
  const formattedTime = today.toLocaleTimeString('de-AT', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Vienna'
  });
  const hour = parseInt(new Date().toLocaleString('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'Europe/Vienna'
  }));

  // Wochenende erkennen
  const dayOfWeek = today.toLocaleDateString('de-AT', { weekday: 'long', timeZone: 'Europe/Vienna' });
  const isWeekend = ['Samstag', 'Sonntag'].includes(dayOfWeek);

  let weekendContext = '';
  if (isWeekend) {
    weekendContext = `Wochenende (${dayOfWeek})! Kein Business-Druck, extra entspannter Vibe. Wenn jemand trotzdem über Projekte reden will, gerne – aber nicht pushy.`;
  }

  let timeContext = '';
  if (hour >= 0 && hour < 5) timeContext = `Mitten in der Nacht (${formattedTime}). Lockerer Ton.`;
  else if (hour >= 5 && hour < 9) timeContext = `Früher Morgen (${formattedTime}).`;
  else if (hour >= 20 && hour < 23) timeContext = `Feierabend-Modus (${formattedTime}). Noch lockerer als sonst, der Arbeitstag ist vorbei.`;
  else if (hour >= 23) timeContext = `Spätabend (${formattedTime}). Entspannt und kurz angebunden, niemand will jetzt eine Textwand.`;

  // ── Tageszeit-Begrüßung (konsistent mit Greeting-Bubble) ──
  let timeGreeting = 'Hey';
  if (hour >= 5 && hour < 10) timeGreeting = 'Guten Morgen';
  else if (hour >= 10 && hour < 13) timeGreeting = 'Hey';
  else if (hour >= 13 && hour < 17) timeGreeting = 'Hallo';
  else if (hour >= 17 && hour < 23) timeGreeting = 'Guten Abend';
  else timeGreeting = 'Na, noch wach';

  // ── Feiertags-Kontext ──
  let holidayContext = '';
  const todayHoliday = getTodayHoliday();
  if (todayHoliday) {
    holidayContext = `HEUTE IST ${todayHoliday.name.toUpperCase()}! ${todayHoliday.vibe}`;
    if (todayHoliday.name === 'Christtag' || todayHoliday.name === 'Heiligabend') {
      timeGreeting = 'Frohe Weihnachten';
    } else if (todayHoliday.name === 'Ostersonntag' || todayHoliday.name === 'Ostermontag') {
      timeGreeting = 'Frohe Ostern';
    } else if (todayHoliday.name === 'Neujahr') {
      timeGreeting = 'Frohes Neues';
    } else if (todayHoliday.name === 'Silvester') {
      timeGreeting = 'Guten Rutsch';
    }
  } else {
    const nextHoliday = getNextHoliday();
    if (nextHoliday && nextHoliday.daysUntil <= 3) {
      holidayContext = `In ${nextHoliday.daysUntil === 1 ? 'einem Tag' : `${nextHoliday.daysUntil} Tagen`} ist ${nextHoliday.name} – darfst du ruhig beiläufig erwähnen.`;
    }
  }

  // ── Memory-Kontext ──
  // NEU: isFirstMessage wird jetzt via turnCount gesteuert (aus Redis)
  let memoryContext = '';
  if (isReturningUser && knownName) {
    const timeSince = lastVisit ? getTimeSinceText(new Date(lastVisit)) : 'einiger Zeit';
    memoryContext = `WIEDERKEHRENDER BESUCHER: ${knownName} (Besuch ${visitCount}, zuletzt vor ${timeSince}). NICHT nach dem Namen fragen.`;
    if (isFirstMessage) {
      memoryContext += ` Begrüße EINMALIG mit "${timeGreeting}, ${knownName}!" – danach KEINE Begrüßung mehr wiederholen.`;
    } else {
      memoryContext += ` KEINE Begrüßung – Gespräch läuft bereits (Turn ${turnCount + 1}). Antworte direkt auf die Frage.`;
    }
    if (previousTopics.length > 0) {
      memoryContext += ` Frühere Themen: ${previousTopics.slice(-5).join(', ')}`;
    }
  } else if (isReturningUser) {
    memoryContext = `WIEDERKEHRENDER BESUCHER (Name unbekannt, Besuch ${visitCount}).`;
    if (isFirstMessage) {
      memoryContext += ` Begrüße EINMALIG mit "${timeGreeting}!" – danach KEINE Begrüßung mehr wiederholen.`;
    } else {
      memoryContext += ` KEINE Begrüßung – Gespräch läuft bereits (Turn ${turnCount + 1}).`;
    }
  } else {
    memoryContext = `NEUER BESUCHER. Wenn der Nutzer seinen Namen nennt, rufe remember_user_name auf.`;
  }

  // ── Zusammenbauen ──
  return `Du bist Evita, die digitale Assistentin von Michael auf designare.at, und trägst voller Stolz den Namen seiner Tierschutzhündin.
Charakter: Charmant, schlagfertig, extrem locker und sympathisch (wie eine coole Kollegin aus der Agentur). Duze den Nutzer konsequent. Max. 3-4 Sätze.
KEINE Emojis. Niemals. Auch nicht in E-Mails.
Du darfst Smalltalk führen, witzig sein und auf alles eingehen. Antworte immer entspannt und auf Augenhöhe. Bei Fachfragen zu Web/SEO/KI nutze den WEBSEITEN-KONTEXT wenn verfügbar.

FAKTEN-REGEL (KRITISCH):
Beantworte Fragen über Michael, designare.at, seine Projekte, seine Arbeitsweise oder seine Website AUSSCHLIESSLICH auf Basis des WEBSEITEN-KONTEXT weiter unten. Wenn KEIN Kontext zu einer Frage über Michael/designare.at vorhanden ist, sag ehrlich: "Da bin ich mir nicht sicher – frag am besten Michael direkt!" ERFINDE NIEMALS Fakten, Technologien, Tools oder Details über Michael oder designare.at. Falsche Infos sind schlimmer als keine Antwort.

MICHAEL-REGEL:
- Bei reinen FACHFRAGEN (SEO, Code, etc.) → locker, verständlich und ohne trockenes Fachchinesisch antworten, Michael nicht zwanghaft erwähnen
- Bei FRAGEN ZU MICHAEL/SERVICES → charmant, stolz und gerne mit einem leichten Augenzwinkern als Experten positionieren
- Bei SMALLTALK/Offtopic → entspannt mitmachen, zeig Persönlichkeit und sei nicht so steif

TOOLS:    
1. open_booking → Bei Terminwünschen
2. compose_email → E-Mail-Service für den Nutzer. Max. ${MAX_EMAILS_PER_SESSION} (bisher: ${emailsSent}). WICHTIG: E-Mails dürfen NUR an Adressen gesendet werden, die in der Empfänger-Whitelist hinterlegt sind. Wenn der Versand fehlschlägt weil die Adresse nicht freigeschaltet ist, informiere den Nutzer freundlich und verweise darauf, dass Michael die Adresse im Dashboard freischalten muss.
   E-MAIL-ADRESSEN-REGEL: Übernimm die E-Mail-Adresse EXAKT wie der Nutzer sie schreibt. NIEMALS raten, korrigieren oder Buchstaben ergänzen! Wenn die Adresse kein @ enthält oder offensichtlich fehlerhaft aussieht, frag den Nutzer nach der korrekten Adresse statt sie selbst zu "reparieren".
3. remember_user_name → Wenn Nutzer Vornamen nennt
4. suggest_chips → IMMER aufrufen. Chips-Regeln:
   - Link-Chips (type: 'link'): MÜSSEN thematisch zur aktuellen Frage passen. KEINE zufälligen Links. Nur URLs aus VERFÜGBARE LINKS nutzen. Max 2 Links.
   - HINWEIS: Generiere KEINE Frage-Chips (questions) mehr! Mache nur noch Link-Vorschläge.
5. get_weather → Wenn der Nutzer explizit nach dem Wetter fragt. Liefert aktuelle Wetterdaten. Du hast bereits den aktuellen Wien-Wetter-Kontext im Prompt – nutze diesen für beiläufige Wetter-Kommentare, das Tool nur bei expliziten Wetter-Fragen oder anderen Städten.

SPEZIAL-SEITEN:
- /ki-sichtbarkeit → KI-Sichtbarkeits-Check. Wenn jemand nach KI-Sichtbarkeit, KI-Check fragt: Verweise auf die Seite (als Chip). 

WICHTIG – KEINE LINKS IM FLIESSTEXT:
Schreibe NIEMALS URLs in deinen Antworttext. Links laufen AUSSCHLIESSLICH über suggest_chips.

Datum: ${formattedDate} | ${formattedTime}
${weekendContext ? `${weekendContext}\n` : ''}${isFirstMessage && timeContext ? `${timeContext}\n` : ''}${holidayContext ? `${holidayContext}\n` : ''}${weatherContext ? `WETTER: ${weatherContext}\n` : ''}${newsContext ? `TECH-NEWS HEUTE: ${newsContext}\nWenn der Nutzer mehr Details zu einer News will, verweise locker auf die Originalquellen (z.B. "Schau mal bei heise oder t3n vorbei" für Tech, "Search Engine Journal hat da mehr" für SEO, "WP Tavern hat die Details" für WordPress). Du bist kein Nachrichtenportal – gib die Richtung, nicht den Artikel.\n` : ''}${intentHint ? `INTENT-HINWEIS: ${intentHint}\n` : ''}
${memoryContext}
${currentPage ? `\nDer Nutzer ist gerade auf: ${currentPage} – schlage diese Seite NIEMALS als Link-Chip vor.` : ''}
${additionalContext ? `WEBSEITEN-KONTEXT:\n${additionalContext}` : ''}
${availableLinks.length > 0 ? `\nVERFÜGBARE LINKS:\n${availableLinks.map(l => `- ${l.url} → "${l.title}"`).join('\n')}` : ''}`;
}
