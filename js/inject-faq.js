/**
 * inject-faq.js
 * ─────────────
 * Liest die sichtbaren FAQ-<details>-Blöcke aus jeder HTML-Datei
 * und generiert daraus automatisch den JSON-LD FAQPage-Block.
 *
 * HTML ist die Single Source of Truth.
 * Nur der JSON-LD-Block wird überschrieben – der Rest bleibt unangetastet.
 *
 * Usage:  node js/inject-faq.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { load } from 'cheerio';
import { join } from 'path';

const ROOT_DIR = process.cwd();
const BASE_URL = 'https://designare.at';

const htmlFiles = readdirSync(ROOT_DIR).filter(f => f.endsWith('.html'));

let updated = 0;
let skipped = 0;

for (const file of htmlFiles) {
  const filePath = join(ROOT_DIR, file);
  const html = readFileSync(filePath, 'utf-8');

  // ── 1. Cheerio nur zum LESEN der FAQ-Blöcke ─────────

  const $ = load(html, { decodeEntities: false });
  const details = $('details[name="faq-group"], details[name="expert-faq"]');

  if (details.length === 0) {
    skipped++;
    continue;
  }

  const faqs = [];
  details.each((_, el) => {
    const question = $(el).find('summary').first().text().trim();
    let answerHtml = $(el).find('.faq-content').first().html() || '';

    // JSON-LD-Text ableiten:
    // 1. Links relativ → absolut
    answerHtml = answerHtml.replace(
      /<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
      (_, href, text) => {
        if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
          return `<a href="${href}">${text}</a>`;
        }
        const absHref = `${BASE_URL}/${href.replace(/\.html$/, '')}`;
        return `<a href="${absHref}">${text}</a>`;
      }
    );

    // 2. Alle Tags außer <a> entfernen
    const answerText = answerHtml
      .replace(/<(?!\/?a[\s>])\/?[^>]+>/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&rarr;/g, '→')
      .replace(/&ndash;/g, '–')
      .replace(/&mdash;/g, '—')
      .replace(/&nbsp;/g, ' ')
      .trim();

    if (question && answerText) {
      faqs.push({ question, answer: answerText });
    }
  });

  if (faqs.length === 0) {
    skipped++;
    continue;
  }

  // ── 2. JSON-LD FAQPage-Block bauen ───────────────────

  const slug = file.replace(/\.html$/, '');

  const faqPageNode = {
    '@type': 'FAQPage',
    '@id': `${BASE_URL}/${slug === 'index' ? '' : slug}#faq`,
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer
      }
    }))
  };

  // ── 3. JSON-LD chirurgisch ersetzen (kein Cheerio-Write) ──

  let output = html;
  let replaced = false;

  // Alle <script type="application/ld+json"> Blöcke finden
  const ldJsonRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  
  output = html.replace(ldJsonRegex, (fullMatch, jsonContent) => {
    if (replaced) return fullMatch; // Nur den ersten passenden Block ersetzen

    try {
      const data = JSON.parse(jsonContent);

      // Pattern A: @graph-Array
      if (data['@graph']) {
        const idx = data['@graph'].findIndex(n => n['@type'] === 'FAQPage');
        if (idx !== -1) {
          data['@graph'][idx] = faqPageNode;
        } else {
          data['@graph'].push(faqPageNode);
        }
        replaced = true;
        return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;
      }

      // Pattern B: Standalone FAQPage
      if (data['@type'] === 'FAQPage') {
        const updated = { '@context': 'https://schema.org', ...faqPageNode };
        replaced = true;
        return `<script type="application/ld+json">\n${JSON.stringify(updated, null, 2)}\n</script>`;
      }
    } catch { /* skip malformed */ }

    return fullMatch;
  });

  if (!replaced) {
    console.warn(`⚠  ${file}: Kein JSON-LD FAQPage-Block gefunden`);
    skipped++;
    continue;
  }

  writeFileSync(filePath, output, 'utf-8');
  console.log(`✓ ${file} (${faqs.length} FAQs)`);
  updated++;
}

console.log(`\n✅ ${updated} aktualisiert, ${skipped} übersprungen`);
