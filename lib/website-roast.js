// lib/website-roast.js - Website-Roast-Analyse für Evita
// Fetcht HTML + PageSpeed Insights, bewertet mit österreichischem Notensystem
// REFACTORED: Cheerio statt Regex für zuverlässiges HTML-Parsing

import { load } from 'cheerio';
import { safeFetch } from './ssrf-guard.js';

const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// ── Österreichisches Notensystem ──
function scoreToGrade(pct) {
  if (pct >= 90) return { note: 1, label: 'Sehr gut', emoji: '🟢' };
  if (pct >= 75) return { note: 2, label: 'Gut', emoji: '🟢' };
  if (pct >= 60) return { note: 3, label: 'Befriedigend', emoji: '🟡' };
  if (pct >= 40) return { note: 4, label: 'Genügend', emoji: '🟠' };
  return { note: 5, label: 'Nicht genügend', emoji: '🔴' };
}

// ── HTML parsen und SEO-Checks (Cheerio) ──
function analyzeHTML(html, url) {
  const $ = load(html);
  const checks = {};

  // Title
  const title = $('title').first().text().trim().replace(/\s+/g, ' ') || null;
  checks.title = {
    exists: !!title,
    value: title,
    length: title ? title.length : 0,
    optimal: title ? (title.length >= 30 && title.length <= 60) : false
  };

  // Meta Description
  const desc = $('meta[name="description"]').attr('content')?.trim() || null;
  checks.metaDescription = {
    exists: !!desc,
    value: desc ? desc.substring(0, 160) : null,
    length: desc ? desc.length : 0,
    optimal: desc ? (desc.length >= 120 && desc.length <= 160) : false
  };

  // H1
  const h1Elements = $('h1');
  const h1Texts = [];
  h1Elements.each((_, el) => {
    const text = $(el).text().trim();
    if (text && h1Texts.length < 3) h1Texts.push(text);
  });
  checks.h1 = {
    count: h1Elements.length,
    values: h1Texts,
    optimal: h1Elements.length === 1
  };

  // H2
  checks.h2 = { count: $('h2').length };

  // Images & Alt-Tags
  const imgElements = $('img');
  let imgsWithAlt = 0;
  let imgsWithoutAlt = 0;
  imgElements.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt && alt.trim().length > 0) {
      imgsWithAlt++;
    } else {
      imgsWithoutAlt++;
    }
  });
  checks.images = {
    total: imgElements.length,
    withAlt: imgsWithAlt,
    withoutAlt: imgsWithoutAlt,
    percentage: imgElements.length > 0 ? Math.round((imgsWithAlt / imgElements.length) * 100) : 100
  };

  // Canonical
  const canonical = $('link[rel="canonical"]').attr('href') || null;
  checks.canonical = {
    exists: !!canonical,
    value: canonical
  };

  // Open Graph
  const ogTitle = $('meta[property="og:title"]').attr('content') || null;
  const ogDesc = $('meta[property="og:description"]').attr('content') || null;
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  checks.openGraph = {
    hasTitle: !!ogTitle,
    hasDescription: !!ogDesc,
    hasImage: !!ogImage,
    complete: !!(ogTitle && ogDesc && ogImage)
  };

  // Twitter Card
  checks.twitterCard = { exists: $('meta[name="twitter:card"]').length > 0 };

  // Viewport
  checks.viewport = { exists: $('meta[name="viewport"]').length > 0 };

  // Language
  const lang = $('html').attr('lang') || null;
  checks.language = {
    exists: !!lang,
    value: lang
  };

  // Favicon
  checks.favicon = {
    exists: $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0
  };

  // HTTPS
  checks.https = { enabled: url.startsWith('https://') };

  // Structured Data (JSON-LD)
  const jsonLD = $('script[type="application/ld+json"]');
  checks.structuredData = { count: jsonLD.length, exists: jsonLD.length > 0 };

  // Robots Meta
  const robotsContent = $('meta[name="robots"]').attr('content') || null;
  checks.robots = {
    exists: !!robotsContent,
    value: robotsContent,
    noindex: robotsContent ? robotsContent.toLowerCase().includes('noindex') : false
  };

  // Inline Styles (Bad Practice)
  let inlineStyleCount = 0;
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    if (style.length >= 20) inlineStyleCount++;
  });
  checks.inlineStyles = { count: inlineStyleCount, excessive: inlineStyleCount > 10 };

  // Render-blocking hints
  // FIX: Korrekte async/defer-Erkennung per Attribut-Check statt kaputter Regex
  const cssFiles = $('link[rel="stylesheet"]').length;
  let syncScripts = 0;
  $('script[src]').each((_, el) => {
    const hasAsync = $(el).attr('async') !== undefined;
    const hasDefer = $(el).attr('defer') !== undefined;
    const hasType = $(el).attr('type');
    // type="module" ist auch nicht render-blocking
    if (!hasAsync && !hasDefer && hasType !== 'module') {
      syncScripts++;
    }
  });
  checks.renderBlocking = { cssFiles, syncScripts };

  return checks;
}

// ── PageSpeed Insights API ──
// HINWEIS: Ohne API-Key (PageSpeed_Insights_API env) gelten strenge Rate-Limits.
// Bei häufiger Nutzung Key setzen: https://developers.google.com/speed/docs/insights/v5/get-started#key
async function fetchPageSpeedInsights(url) {
  try {
    const psiKey = process.env.PageSpeed_Insights_API || '';
    const apiUrl = `${PAGESPEED_API}?url=${encodeURIComponent(url)}${psiKey ? `&key=${psiKey}` : ''}&category=performance&category=seo&category=accessibility&category=best-practices&strategy=mobile`;
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      console.warn(`⚠️ PageSpeed API HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const categories = data.lighthouseResult?.categories || {};
    const audits = data.lighthouseResult?.audits || {};

    return {
      scores: {
        performance: Math.round((categories.performance?.score || 0) * 100),
        seo: Math.round((categories.seo?.score || 0) * 100),
        accessibility: Math.round((categories.accessibility?.score || 0) * 100),
        bestPractices: Math.round((categories['best-practices']?.score || 0) * 100)
      },
      metrics: {
        fcp: audits['first-contentful-paint']?.displayValue || null,
        lcp: audits['largest-contentful-paint']?.displayValue || null,
        cls: audits['cumulative-layout-shift']?.displayValue || null,
        tbt: audits['total-blocking-time']?.displayValue || null,
        si: audits['speed-index']?.displayValue || null,
        tti: audits['interactive']?.displayValue || null
      },
      loadTime: audits['interactive']?.numericValue
        ? Math.round(audits['interactive'].numericValue / 100) / 10 + 's'
        : null
    };
  } catch (err) {
    console.warn(`⚠️ PageSpeed Fehler: ${err.message}`);
    return null;
  }
}

// ── Kategorien bewerten ──
function calculateScores(htmlChecks, pageSpeed) {
  const categories = {};

  // 1. SEO Basics (30% Gewicht)
  let seoScore = 0;
  let seoMax = 0;
  const seoItems = [];

  // Title
  seoMax += 20;
  if (htmlChecks.title.exists && htmlChecks.title.optimal) {
    seoScore += 20;
    seoItems.push({ check: 'Title-Tag', status: 'pass', detail: `"${htmlChecks.title.value}" (${htmlChecks.title.length} Zeichen)` });
  } else if (htmlChecks.title.exists) {
    seoScore += 10;
    const issue = htmlChecks.title.length < 30 ? 'zu kurz' : htmlChecks.title.length > 60 ? 'zu lang' : 'ok';
    seoItems.push({ check: 'Title-Tag', status: 'warn', detail: `${htmlChecks.title.length} Zeichen (${issue}, ideal: 30-60)` });
  } else {
    seoItems.push({ check: 'Title-Tag', status: 'fail', detail: 'Fehlt komplett!' });
  }

  // Meta Description
  seoMax += 20;
  if (htmlChecks.metaDescription.exists && htmlChecks.metaDescription.optimal) {
    seoScore += 20;
    seoItems.push({ check: 'Meta Description', status: 'pass', detail: `${htmlChecks.metaDescription.length} Zeichen` });
  } else if (htmlChecks.metaDescription.exists) {
    seoScore += 10;
    seoItems.push({ check: 'Meta Description', status: 'warn', detail: `${htmlChecks.metaDescription.length} Zeichen (ideal: 120-160)` });
  } else {
    seoItems.push({ check: 'Meta Description', status: 'fail', detail: 'Fehlt!' });
  }

  // H1
  seoMax += 15;
  if (htmlChecks.h1.optimal) {
    seoScore += 15;
    seoItems.push({ check: 'H1-Überschrift', status: 'pass', detail: `"${htmlChecks.h1.values[0]}"` });
  } else if (htmlChecks.h1.count > 1) {
    seoScore += 5;
    seoItems.push({ check: 'H1-Überschrift', status: 'warn', detail: `${htmlChecks.h1.count} H1-Tags (sollte nur 1 sein)` });
  } else {
    seoItems.push({ check: 'H1-Überschrift', status: 'fail', detail: 'Keine H1 gefunden!' });
  }

  // Alt-Tags
  seoMax += 15;
  if (htmlChecks.images.total === 0 || htmlChecks.images.percentage >= 90) {
    seoScore += 15;
    seoItems.push({ check: 'Bild-Alt-Tags', status: 'pass', detail: `${htmlChecks.images.withAlt}/${htmlChecks.images.total} Bilder haben Alt-Text` });
  } else if (htmlChecks.images.percentage >= 50) {
    seoScore += 8;
    seoItems.push({ check: 'Bild-Alt-Tags', status: 'warn', detail: `Nur ${htmlChecks.images.percentage}% mit Alt-Text (${htmlChecks.images.withoutAlt} fehlen)` });
  } else {
    seoItems.push({ check: 'Bild-Alt-Tags', status: 'fail', detail: `Nur ${htmlChecks.images.percentage}% – ${htmlChecks.images.withoutAlt} Bilder ohne Alt-Text!` });
  }

  // Canonical
  seoMax += 10;
  if (htmlChecks.canonical.exists) {
    seoScore += 10;
    seoItems.push({ check: 'Canonical-Tag', status: 'pass', detail: 'Vorhanden' });
  } else {
    seoItems.push({ check: 'Canonical-Tag', status: 'fail', detail: 'Fehlt' });
  }

  // Structured Data
  seoMax += 10;
  if (htmlChecks.structuredData.exists) {
    seoScore += 10;
    seoItems.push({ check: 'Strukturierte Daten', status: 'pass', detail: `${htmlChecks.structuredData.count} JSON-LD Block(s)` });
  } else {
    seoItems.push({ check: 'Strukturierte Daten', status: 'fail', detail: 'Keine JSON-LD gefunden' });
  }

  // Robots noindex check
  if (htmlChecks.robots.noindex) {
    seoItems.push({ check: 'Robots', status: 'fail', detail: 'ACHTUNG: noindex gesetzt! Seite wird nicht indexiert!' });
  }

  const seoPct = Math.round((seoScore / seoMax) * 100);
  categories.seo = { ...scoreToGrade(seoPct), score: seoPct, items: seoItems, weight: 30 };

  // 2. Performance (30% Gewicht)
  const perfPct = pageSpeed?.scores?.performance ?? 50;
  const perfItems = [];
  if (pageSpeed) {
    perfItems.push({ check: 'Lighthouse Performance', status: perfPct >= 75 ? 'pass' : perfPct >= 50 ? 'warn' : 'fail', detail: `${perfPct}/100` });
    if (pageSpeed.metrics.lcp) perfItems.push({ check: 'Largest Contentful Paint', status: parseFloat(pageSpeed.metrics.lcp) <= 2.5 ? 'pass' : 'warn', detail: pageSpeed.metrics.lcp });
    if (pageSpeed.metrics.cls) perfItems.push({ check: 'Cumulative Layout Shift', status: parseFloat(pageSpeed.metrics.cls) <= 0.1 ? 'pass' : 'warn', detail: pageSpeed.metrics.cls });
    if (pageSpeed.metrics.tbt) perfItems.push({ check: 'Total Blocking Time', status: parseFloat(pageSpeed.metrics.tbt) <= 200 ? 'pass' : 'warn', detail: pageSpeed.metrics.tbt });
    if (pageSpeed.metrics.fcp) perfItems.push({ check: 'First Contentful Paint', status: 'info', detail: pageSpeed.metrics.fcp });
    if (pageSpeed.loadTime) perfItems.push({ check: 'Time to Interactive', status: 'info', detail: pageSpeed.loadTime });
  } else {
    perfItems.push({ check: 'PageSpeed Test', status: 'warn', detail: 'Konnte nicht abgerufen werden' });
  }
  categories.performance = { ...scoreToGrade(perfPct), score: perfPct, items: perfItems, weight: 30 };

  // 3. Mobile & UX (20% Gewicht)
  let mobilePct = 0;
  const mobileItems = [];

  if (htmlChecks.viewport.exists) {
    mobilePct += 40;
    mobileItems.push({ check: 'Viewport Meta-Tag', status: 'pass', detail: 'Vorhanden' });
  } else {
    mobileItems.push({ check: 'Viewport Meta-Tag', status: 'fail', detail: 'Fehlt! Seite ist nicht mobile-optimiert.' });
  }

  const a11yScore = pageSpeed?.scores?.accessibility ?? 50;
  mobilePct += Math.round(a11yScore * 0.6);
  mobileItems.push({ check: 'Accessibility Score', status: a11yScore >= 75 ? 'pass' : a11yScore >= 50 ? 'warn' : 'fail', detail: `${a11yScore}/100` });

  categories.mobile = { ...scoreToGrade(mobilePct), score: mobilePct, items: mobileItems, weight: 20 };

  // 4. Social & Sharing (10% Gewicht)
  let socialPct = 0;
  const socialItems = [];

  if (htmlChecks.openGraph.complete) {
    socialPct = 100;
    socialItems.push({ check: 'Open Graph Tags', status: 'pass', detail: 'Titel, Beschreibung & Bild vorhanden' });
  } else if (htmlChecks.openGraph.hasTitle || htmlChecks.openGraph.hasDescription) {
    socialPct = 50;
    const missing = [];
    if (!htmlChecks.openGraph.hasTitle) missing.push('og:title');
    if (!htmlChecks.openGraph.hasDescription) missing.push('og:description');
    if (!htmlChecks.openGraph.hasImage) missing.push('og:image');
    socialItems.push({ check: 'Open Graph Tags', status: 'warn', detail: `Unvollständig – fehlt: ${missing.join(', ')}` });
  } else {
    socialItems.push({ check: 'Open Graph Tags', status: 'fail', detail: 'Komplett fehlend! Kein Vorschaubild beim Teilen.' });
  }

  if (htmlChecks.twitterCard.exists) {
    socialPct = Math.min(100, socialPct + 20);
    socialItems.push({ check: 'Twitter Card', status: 'pass', detail: 'Vorhanden' });
  }

  categories.social = { ...scoreToGrade(socialPct), score: socialPct, items: socialItems, weight: 10 };

  // 5. Technik & Sicherheit (10% Gewicht)
  let techPct = 0;
  const techItems = [];

  if (htmlChecks.https.enabled) {
    techPct += 40;
    techItems.push({ check: 'HTTPS', status: 'pass', detail: 'Verschlüsselt' });
  } else {
    techItems.push({ check: 'HTTPS', status: 'fail', detail: 'Kein HTTPS! Unsicher und schlecht fürs Ranking.' });
  }

  if (htmlChecks.language.exists) {
    techPct += 20;
    techItems.push({ check: 'Sprach-Attribut', status: 'pass', detail: `lang="${htmlChecks.language.value}"` });
  } else {
    techItems.push({ check: 'Sprach-Attribut', status: 'fail', detail: 'Fehlt im <html>-Tag' });
  }

  if (htmlChecks.favicon.exists) {
    techPct += 20;
    techItems.push({ check: 'Favicon', status: 'pass', detail: 'Vorhanden' });
  } else {
    techItems.push({ check: 'Favicon', status: 'warn', detail: 'Nicht gefunden' });
  }

  const bpScore = pageSpeed?.scores?.bestPractices ?? 50;
  techPct += Math.round(bpScore * 0.2);
  techItems.push({ check: 'Best Practices Score', status: bpScore >= 75 ? 'pass' : bpScore >= 50 ? 'warn' : 'fail', detail: `${bpScore}/100` });

  categories.tech = { ...scoreToGrade(techPct), score: techPct, items: techItems, weight: 10 };

  // ── Gesamtnote (gewichtet) ──
  const totalPct = Math.round(
    (categories.seo.score * categories.seo.weight +
      categories.performance.score * categories.performance.weight +
      categories.mobile.score * categories.mobile.weight +
      categories.social.score * categories.social.weight +
      categories.tech.score * categories.tech.weight) / 100
  );

  const overall = scoreToGrade(totalPct);

  return { categories, overall: { ...overall, score: totalPct } };
}

/**
 * Hauptfunktion: Website analysieren und Roast-Daten generieren
 * @param {string} inputUrl - Die zu analysierende URL
 * @returns {Object} Roast-Ergebnis mit Kategorien, Noten und Roast-Text
 */
export async function roastWebsite(inputUrl) {
  // URL normalisieren
  let url = inputUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  console.log(`🔥 Website-Roast gestartet: ${url}`);
  const startTime = Date.now();

  // ── Parallel: HTML fetchen + PageSpeed Insights ──
  const [htmlResult, pageSpeed] = await Promise.allSettled([
    // HTML Fetch
    (async () => {
      const response = await safeFetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Evita-Roast/1.0; +https://designare.at)',
          'Accept': 'text/html',
          'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const responseTime = Date.now() - startTime;
      return { html, responseTime, statusCode: response.status, finalUrl: response.url };
    })(),
    // PageSpeed
    fetchPageSpeedInsights(url)
  ]);

  // HTML-Ergebnis verarbeiten
  if (htmlResult.status === 'rejected') {
    throw new Error(`Website nicht erreichbar: ${htmlResult.reason.message}`);
  }

  const { html, responseTime, finalUrl } = htmlResult.value;
  const pageSpeedData = pageSpeed.status === 'fulfilled' ? pageSpeed.value : null;

  // ── Analyse durchführen ──
  const htmlChecks = analyzeHTML(html, finalUrl || url);
  const scoring = calculateScores(htmlChecks, pageSpeedData);

  const duration = Date.now() - startTime;
  console.log(`🔥 Website-Roast fertig in ${duration}ms – Note: ${scoring.overall.note}`);

  // ── Ergebnis zusammenbauen ──
  return {
    url: finalUrl || url,
    analyzedAt: new Date().toISOString(),
    duration: `${Math.round(duration / 100) / 10}s`,
    responseTime: `${responseTime}ms`,
    overall: scoring.overall,
    categories: {
      seo: {
        name: 'SEO Basics',
        ...scoring.categories.seo
      },
      performance: {
        name: 'Performance',
        ...scoring.categories.performance
      },
      mobile: {
        name: 'Mobile & UX',
        ...scoring.categories.mobile
      },
      social: {
        name: 'Social & Sharing',
        ...scoring.categories.social
      },
      tech: {
        name: 'Technik & Sicherheit',
        ...scoring.categories.tech
      }
    },
    highlights: {
      bestCategory: Object.entries(scoring.categories)
        .sort((a, b) => b[1].score - a[1].score)[0],
      worstCategory: Object.entries(scoring.categories)
        .sort((a, b) => a[1].score - b[1].score)[0],
      criticalFails: Object.values(scoring.categories)
        .flatMap(c => c.items.filter(i => i.status === 'fail'))
        .map(i => i.check),
      quickWins: Object.values(scoring.categories)
        .flatMap(c => c.items.filter(i => i.status === 'warn'))
        .slice(0, 3)
        .map(i => `${i.check}: ${i.detail}`)
    },
    pageSpeed: pageSpeedData ? {
      scores: pageSpeedData.scores,
      metrics: pageSpeedData.metrics
    } : null
  };
}
