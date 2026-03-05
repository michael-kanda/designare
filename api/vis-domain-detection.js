// lib/domain-detection.js - Domain-Erkennung, Validierung, Content-Fallback

// =================================================================
// HELPER: Domain-Erwähnung erkennen (flexibel)
// Erkennt auch "Stempel Lobenhofer" für "stempel-lobenhofer.at"
// =================================================================
export function isDomainMentioned(text, cleanDomain) {
  const lower = text.toLowerCase();
  
  // Exakte Domain (stempel-lobenhofer.at)
  if (lower.includes(cleanDomain)) {
    if (isNegationContext(lower)) return false;
    return true;
  }
  
  // Domain ohne TLD (stempel-lobenhofer)
  const domainBase = cleanDomain.replace(/\.[^.]+$/, '');
  if (lower.includes(domainBase)) {
    if (isNegationContext(lower)) return false;
    return true;
  }
  
  // Bindestriche durch Leerzeichen ersetzen (stempel lobenhofer)
  const domainWords = domainBase.replace(/-/g, ' ');
  if (domainWords !== domainBase && lower.includes(domainWords)) {
    if (isNegationContext(lower)) return false;
    return true;
  }
  
  // =================================================================
  // EINZELTEILE-PRÜFUNG (mit Schutz gegen False Positives)
  // =================================================================
  const parts = domainBase.split(/[-.]/).filter(p => p.length >= 4);
  
  if (parts.length >= 2) {
    // Generische Wörter, die in KI-Antworten natürlich vorkommen
    const genericWords = new Set([
      // Branchen & Berufe
      'auto', 'hotel', 'shop', 'design', 'digital', 'online', 'service',
      'agentur', 'group', 'media', 'consulting', 'tech', 'studio', 'team',
      'partner', 'expert', 'profi', 'center', 'haus', 'werk', 'plus',
      'best', 'first', 'smart', 'easy', 'global', 'premium', 'prime',
      'rechtsanwalt', 'steuerberater', 'immobilien', 'versicherung',
      'marketing', 'software', 'development', 'solutions', 'systems',
      'handwerk', 'elektro', 'transport', 'logistik', 'bauer', 'garten',
      'restaurant', 'gastro', 'sport', 'fitness', 'beauty', 'dental',
      // Orte (DACH)
      'wien', 'graz', 'linz', 'salzburg', 'innsbruck', 'bregenz', 'klagenfurt',
      'berlin', 'hamburg', 'münchen', 'muenchen', 'frankfurt', 'köln', 'koeln',
      'stuttgart', 'düsseldorf', 'duesseldorf', 'dortmund', 'essen', 'leipzig',
      'zürich', 'zuerich', 'bern', 'basel', 'genf',
      'austria', 'österreich', 'oesterreich', 'deutschland', 'germany', 'schweiz',
      // Generische Begriffe
      'info', 'data', 'home', 'page', 'site', 'mail', 'news', 'blog',
      'book', 'deal', 'sale', 'fair', 'pure', 'real', 'true', 'good',
      'north', 'south', 'east', 'west', 'city', 'land', 'park'
    ]);
    
    // Wie viele Teile sind NICHT generisch?
    const uniqueParts = parts.filter(p => !genericWords.has(p));
    
    // Fall 1: Alle Teile generisch → kein Match über Einzelteile
    if (uniqueParts.length === 0) {
      return false;
    }
    
    // Fall 2: Mindestens ein Teil ist unique → Proximity-Check
    if (parts.every(part => lower.includes(part))) {
      const positions = parts.map(part => {
        const idx = lower.indexOf(part);
        return { part, start: idx, end: idx + part.length };
      });
      
      // Sortiere nach Position im Text
      positions.sort((a, b) => a.start - b.start);
      
      // Maximaler Abstand zwischen dem Ende des ersten und Anfang des letzten Teils
      const first = positions[0];
      const last = positions[positions.length - 1];
      const distance = last.start - first.end;
      
      // Max 60 Zeichen Abstand (≈ ein kurzer Nebensatz)
      if (distance <= 60) {
        if (isNegationContext(lower)) return false;
        return true;
      }
    }
  }
  
  return false;
}

// =================================================================
// Prüft ob der Text eine Negation enthält
// =================================================================
function isNegationContext(textLower) {
  // Definitive Negationen — hier ist eindeutig nichts gefunden, kein Substanz-Check nötig
  const definitiveNegations = [
    'keine online-bewertungen',
    'keine bewertungen gefunden',
    'keine rezensionen gefunden',
    'keine bewertungen auf',
    'wurden keine bewertungen',
    'wurden keine online-bewertungen',
    'keine externen erwähnungen',
    'keine erwähnungen gefunden',
    'wurden keine erwähnungen',
    'keine externen erwähnungen auf anderen',
    'beziehen sich jedoch nicht auf',
  ];
  if (definitiveNegations.some(p => textLower.includes(p))) return true;

  // Allgemeine Negationen — werden gegen Substanz-Check geprüft
  const negationPatterns = [
    'keine informationen',
    'nicht bekannt',
    'nichts bekannt',
    'keine daten',
    'keine kenntnis',
    'nicht gefunden',
    'keine ergebnisse',
    'mir nicht bekannt',
    'habe ich keine',
    'kann ich keine',
    'wurden keine informationen',
    'no information',
    'not familiar',
  ];
  
  const hasNegation = negationPatterns.some(p => textLower.includes(p));
  if (!hasNegation) return false;
  
  // Substanz-Check: Hat die Antwort trotz Negation echte Unternehmensinfos?
  const hasSubstance = 
    textLower.includes('bietet') ||
    textLower.includes('dienstleistung') ||
    textLower.includes('unternehmen') ||
    textLower.includes('spezialisiert') ||
    textLower.includes('tätig') ||
    textLower.includes('anbieter') ||
    textLower.includes('standort') ||
    textLower.includes('gelistet') ||      
    textLower.includes('profil');           
  
  return !hasSubstance;
}

// =================================================================
// Content-Fallback – Erkennt substanzielle Unternehmensantworten
// auch wenn isDomainMentioned den exakten Domain-Namen nicht matcht
// =================================================================
export function isSubstantialBusinessResponse(plainText, cleanDomain, testType = 'knowledge') {
  const lower = plainText.toLowerCase();
  
  // Prüfe ob die Antwort explizit sagt, dass nichts gefunden wurde
  const notFoundPatterns = [
    'keine informationen gefunden',
    'nicht gefunden',
    'habe ich keine informationen',
    'keine daten verfügbar',
    'kann ich keine angaben',
    'mir nicht bekannt',
    'wurden keine informationen',
    'no information found',
    'i don\'t have information',
    'keine bewertungen gefunden',
    'keine online-bewertungen',
    'keine rezensionen gefunden',
    'keine externen erwähnungen',
    'keine erwähnungen gefunden'
  ];
  if (notFoundPatterns.some(p => lower.includes(p))) return false;
  
  // Substanz-Indikatoren je nach Test-Typ
  const keywordSets = {
    knowledge: [
      'bietet', 'anbieter', 'dienstleistung', 'produkt', 'unternehmen',
      'firma', 'standort', 'spezialisiert', 'tätig', 'gegründet', 'gmbh',
      'agentur', 'vermittlung', 'betreuung', 'service', 'branche',
      'mitarbeiter', 'geschäftsführ', 'inhaber', 'sitz in', 'ansässig'
    ],
    reviews: [
      'bewertung', 'rezension', 'sterne', 'stars', 'rating', 'review',
      'google reviews', 'trustpilot', 'provenexpert', 'kununu',
      'zufrieden', 'empfehlen', 'erfahrung', 'kundenmeinung',
      'positiv', 'von 5', 'durchschnitt', 'feedback'
    ],
    mentions: [
      'herold', 'wko', 'gelbe seiten', 'firmenabc', 'branchenverzeichnis',
      'facebook', 'instagram', 'linkedin', 'xing', 'erwähnt', 'gelistet',
      'verzeichnis', 'profil', 'eintrag', 'social media', 'verlinkt'
    ]
  };
  
  const keywords = keywordSets[testType] || keywordSets.knowledge;
  const matchCount = keywords.filter(kw => lower.includes(kw)).length;
  
  // Mindestens 3 Indikatoren UND mindestens 80 Zeichen Text
  if (matchCount >= 3 && plainText.length >= 80) {
    console.log(`   → Substanz-Check (${testType}): ${matchCount} Keywords gefunden`);
    return true;
  }
  
  return false;
}

// =================================================================
// DOMAIN VALIDATION
// =================================================================
export function validateAndCleanDomain(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, domain: null, error: 'Domain ist erforderlich' };
  }

  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^[a-z]+:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.replace(/\/.*$/, '');
  domain = domain.replace(/:\d+$/, '');

  if (/\s/.test(domain)) {
    return { valid: false, domain: null, error: 'Domain darf keine Leerzeichen enthalten' };
  }

  const dangerousPatterns = [
    /[<>'"`;]/,
    /--/,
    /\/\*/,
    /\.\./,
    /\x00/,
    /javascript:/i,
    /data:/i,
    /vbscript:/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(domain)) {
      return { valid: false, domain: null, error: 'Ungültige Zeichen in der Domain' };
    }
  }

  if (domain.length > 253 || domain.length < 4) {
    return { valid: false, domain: null, error: 'Ungültige Domain-Länge' };
  }

  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, domain: null, error: 'Ungültiges Domain-Format' };
  }

  const invalidTLDs = ['localhost', 'local', 'test', 'invalid', 'example'];
  if (invalidTLDs.includes(domain.split('.').pop())) {
    return { valid: false, domain: null, error: 'Test-Domains nicht erlaubt' };
  }

  return { valid: true, domain: domain, error: null };
}

// =================================================================
// HELPER: Industry sanitizen
// =================================================================
export function sanitizeIndustry(input) {
  if (!input || typeof input !== 'string') return null;
  let industry = input.trim().substring(0, 100);
  industry = industry.replace(/[<>'"`;\\]/g, '');
  return industry.length > 0 ? industry : null;
}
