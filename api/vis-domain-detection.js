// lib/domain-detection.js - Domain-Erkennung, Validierung, Content-Fallback
// Nutzt zentrale Konstanten aus vis-constants.js

import {
  NEGATION_PATTERNS,
  GENERIC_DOMAIN_WORDS,
  PLATFORM_NAMES,
  getNotFoundPatterns,
  getSubstanceKeywords,
} from './vis-constants.js';

// =================================================================
// Firmennamen aus Gemini-Antwort extrahieren
// =================================================================
export function extractCompanyName(rawResponseText, cleanDomain) {
  if (!rawResponseText) return null;
  
  const boldMatches = rawResponseText.match(/\*\*([^*]{3,80})\*\*/g);
  if (boldMatches) {
    const domainBase = cleanDomain.replace(/\.[^.]+$/, '').replace(/-/g, ' ').toLowerCase();
    
    for (const match of boldMatches) {
      const name = match.replace(/\*\*/g, '').trim();
      const nameLower = name.toLowerCase();
      
      if (nameLower === cleanDomain) continue;
      if (/^https?:\/\//.test(nameLower) || /^[a-z0-9-]+\.(at|de|com|ch|org|net)$/i.test(nameLower)) continue;
      if (PLATFORM_NAMES.has(nameLower)) continue;
      
      const domainParts = domainBase.split(/\s+/).filter(p => p.length >= 3);
      const nameParts = nameLower.split(/\s+/);
      const hasOverlap = domainParts.some(dp => nameParts.some(np => np.includes(dp) || dp.includes(np)));
      
      if (hasOverlap || /\b(gmbh|kg|og|e\.u\.|ug|ag|ohg|sarl|ltd|inc)\b/i.test(name)) {
        return name;
      }
    }
    
    for (const match of boldMatches) {
      const name = match.replace(/\*\*/g, '').trim();
      if (name.length >= 5 && !/\.(at|de|com|ch|org|net)/.test(name) && name.toLowerCase() !== cleanDomain) {
        return name;
      }
    }
  }
  
  const aliasPatterns = [
    /auch bekannt als\s+(?:\*\*)?([^*\n,.]{3,60})(?:\*\*)?/i,
    /\(auch\s+([^)]{3,60})\)/i,
  ];
  for (const pattern of aliasPatterns) {
    const m = rawResponseText.match(pattern);
    if (m) return m[1].trim();
  }
  
  return null;
}

// =================================================================
// Domain-Erwähnung erkennen
// =================================================================
export function isDomainMentioned(text, cleanDomain, testType = 'knowledge') {
  const lower = text.toLowerCase();
  
  if (lower.includes(cleanDomain)) {
    if (isNegationContext(lower, testType)) return false;
    return true;
  }
  
  const domainBase = cleanDomain.replace(/\.[^.]+$/, '');
  if (lower.includes(domainBase)) {
    if (isNegationContext(lower, testType)) return false;
    return true;
  }
  
  const domainWords = domainBase.replace(/-/g, ' ');
  if (domainWords !== domainBase && lower.includes(domainWords)) {
    if (isNegationContext(lower, testType)) return false;
    return true;
  }
  
  // Einzelteile-Prüfung
  const parts = domainBase.split(/[-.]/).filter(p => p.length >= 4);
  
  if (parts.length >= 2) {
    const uniqueParts = parts.filter(p => !GENERIC_DOMAIN_WORDS.has(p));
    if (uniqueParts.length === 0) return false;
    
    if (parts.every(part => lower.includes(part))) {
      const allPositionSets = parts.map(part => {
        const positions = [];
        let idx = lower.indexOf(part);
        while (idx !== -1) {
          positions.push({ part, start: idx, end: idx + part.length });
          idx = lower.indexOf(part, idx + 1);
        }
        return positions;
      });
      
      for (const anchor of allPositionSets[0]) {
        let allClose = true;
        let minStart = anchor.start;
        let maxEnd = anchor.end;
        
        for (let i = 1; i < allPositionSets.length; i++) {
          let closest = null;
          let closestDist = Infinity;
          for (const pos of allPositionSets[i]) {
            const dist = Math.abs(pos.start - anchor.start);
            if (dist < closestDist) { closestDist = dist; closest = pos; }
          }
          if (!closest) { allClose = false; break; }
          minStart = Math.min(minStart, closest.start);
          maxEnd = Math.max(maxEnd, closest.end);
        }
        
        if (allClose && (maxEnd - minStart) <= 80) {
          if (isNegationContext(lower, testType)) return false;
          return true;
        }
      }
    }
  }
  
  return false;
}

// =================================================================
// Negations-Kontext prüfen (test-typ-aware)
// =================================================================
function isNegationContext(textLower, testType = 'knowledge') {
  // Definitive Negationen
  if (NEGATION_PATTERNS.definitive.some(p => textLower.includes(p))) return true;

  // Test-spezifische Negationen (mit Substanz+Kontradiktions-Check)
  const specificPatterns = NEGATION_PATTERNS.testSpecific[testType] || [];
  if (specificPatterns.some(p => textLower.includes(p))) {
    const hasSubstance = checkSubstanceForTestType(textLower, testType);
    const hasContradiction = /\b(?:jedoch|aber|allerdings|dennoch|trotzdem|nichtsdestotrotz|gleichzeitig)\b/.test(textLower);
    
    if (hasSubstance && hasContradiction) {
      console.log(`   → Negation überstimmt: Substanz (${testType}) + Kontradiktion`);
      return false;
    }
    return true;
  }

  // Allgemeine Negationen (mit Substanz-Check)
  if (NEGATION_PATTERNS.general.some(p => textLower.includes(p))) {
    return !checkSubstanceForTestType(textLower, testType);
  }
  
  return false;
}

// =================================================================
// Substanz-Check je nach Test-Typ
// =================================================================
function checkSubstanceForTestType(textLower, testType) {
  const keywords = getSubstanceKeywords(testType);
  const matchCount = keywords.filter(kw => textLower.includes(kw)).length;
  return matchCount >= 2;
}

// =================================================================
// Content-Fallback
// =================================================================
export function isSubstantialBusinessResponse(plainText, cleanDomain, testType = 'knowledge') {
  const lower = plainText.toLowerCase();
  
  const keywords = getSubstanceKeywords(testType);
  const matchCount = keywords.filter(kw => lower.includes(kw)).length;
  
  const hasStrongSubstance = matchCount >= 5 && plainText.length >= 100;
  const hasMediumSubstance = matchCount >= 3 && plainText.length >= 80;
  
  const notFoundPatterns = getNotFoundPatterns(testType);
  const hasNotFound = notFoundPatterns.some(p => lower.includes(p));
  
  if (hasNotFound) {
    if (hasStrongSubstance) {
      console.log(`   → Substanz-Check (${testType}): ${matchCount} Keywords überstimmen notFound`);
      return true;
    }
    return false;
  }
  
  if (hasMediumSubstance) {
    console.log(`   → Substanz-Check (${testType}): ${matchCount} Keywords gefunden`);
    return true;
  }
  
  return false;
}

// =================================================================
// DOMAIN VALIDATION (unverändert)
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
    /[<>'"`;]/, /--/, /\/\*/, /\.\./, /\x00/,
    /javascript:/i, /data:/i, /vbscript:/i,
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
// Industry sanitizen (unverändert)
// =================================================================
export function sanitizeIndustry(input) {
  if (!input || typeof input !== 'string') return null;
  let industry = input.trim().substring(0, 100);
  industry = industry.replace(/[<>'"`;\\]/g, '');
  return industry.length > 0 ? industry : null;
}
