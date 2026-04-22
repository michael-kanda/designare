/**
 * inject-author.js
 * ────────────────────────────────────────────
 * Injiziert die Autoren-Box in alle Blog-Artikel.
 * Erkennt Artikel an der Klasse "blog-article".
 * Platzierung: vor <div id="feedback-placeholder">
 *
 * Usage:  node js/inject-author.js
 * Build:  wird über build-runner.js aufgerufen
 * ────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

// ── Konfiguration ──────────────────────────────────────────

const ROOT = resolve('.');
const EXCLUDED = ['node_modules', '.git', 'dist', 'js', 'css', 'font', 'images', 'api'];

const AUTHORS = {
    'michael-kanda': {
        name: 'Michael Kanda',
        role: 'Komplize für Web & KI',
        bio: 'WordPress ohne Ballast, Code ohne Kompromisse, KI mit Verstand. Macht Webseiten sichtbar\u00a0– bei Google und in der KI-Suche.',
        url: 'https://designare.at/',
        urlLabel: 'Über Michael',
        image: 'images/michael-kanda.webp',
        illustration: 'images/michael-evita-ai.webp',
        socials: [
            { platform: 'github', url: 'https://github.com/michael-kanda', icon: 'fa-brands fa-github', label: 'GitHub' },
            { platform: 'linkedin', url: 'https://www.linkedin.com/in/michael-kanda-408910341/', icon: 'fa-brands fa-linkedin', label: 'LinkedIn' },
            { platform: 'wordpress', url: 'https://profiles.wordpress.org/michaelmedientechnik/', icon: 'fa-brands fa-wordpress', label: 'WordPress.org' }
        ]
    }
    // Weitere Autoren hier ergänzen
};

const DEFAULT_AUTHOR = 'michael-kanda';

// ── Marker ─────────────────────────────────────────────────

const MARKER_START = '<!-- AUTHOR-BOX:START -->';
const MARKER_END   = '<!-- AUTHOR-BOX:END -->';

// ── Author-Box HTML generieren ─────────────────────────────

function buildAuthorHTML(authorKey) {
    const a = AUTHORS[authorKey];
    if (!a) return '';

    const socialsHTML = a.socials.map(s =>
        `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="author-social" title="${s.label}" aria-label="${s.label}">` +
        `<i class="${s.icon}" aria-hidden="true"></i></a>`
    ).join('\n                        ');

    return `
${MARKER_START}
            <aside class="author-box" aria-label="Über den Autor" itemscope itemtype="https://schema.org/Person">
                <div class="author-avatar-wrap">
                    <a href="${a.url}" class="author-avatar-link" aria-label="${a.urlLabel}">
                        <img src="${a.illustration}" 
                             alt="${a.name} – Illustration" 
                             class="author-avatar author-avatar--illustration" 
                             width="120" height="120"
                             loading="lazy">
                        <img src="${a.image}" 
                             alt="${a.name}" 
                             class="author-avatar author-avatar--photo" 
                             itemprop="image"
                             width="120" height="120"
                             loading="lazy">
                    </a>
                </div>
                <div class="author-info">
                    <div class="author-label">Geschrieben von</div>
                    <h3 class="author-name" itemprop="name">
                        <a href="${a.url}" itemprop="url">${a.name}</a>
                    </h3>
                    <p class="author-role" itemprop="jobTitle">${a.role}</p>
                    <p class="author-bio" itemprop="description">${a.bio}</p>
                    <div class="author-socials">
                        ${socialsHTML}
                    </div>
                </div>
            </aside>
${MARKER_END}`;
}

// ── HTML-Dateien finden ────────────────────────────────────

function findHTMLFiles(dir) {
    let files = [];
    for (const entry of readdirSync(dir)) {
        if (EXCLUDED.includes(entry)) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            files = files.concat(findHTMLFiles(full));
        } else if (entry.endsWith('.html')) {
            files.push(full);
        }
    }
    return files;
}

// ── Injection ──────────────────────────────────────────────

function inject() {
    const files = findHTMLFiles(ROOT);
    let injected = 0;
    let skipped = 0;

    for (const file of files) {
        let html = readFileSync(file, 'utf-8');

        // Nur Blog-Artikel (haben class="blog-article")
        if (!html.includes('class="blog-article"')) {
            continue;
        }

        // Autor aus data-author Attribut oder Default
        const authorMatch = html.match(/data-author="([^"]+)"/);
        const authorKey = authorMatch ? authorMatch[1] : DEFAULT_AUTHOR;
        const authorHTML = buildAuthorHTML(authorKey);

        if (!authorHTML) {
            console.log(`  ⚠ Unbekannter Autor "${authorKey}" in ${file}`);
            continue;
        }

        // Alte Author-Box entfernen (idempotent)
        const markerRegex = new RegExp(
            `\\n?${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}\\n?`,
            'g'
        );
        html = html.replace(markerRegex, '');

        // Injection-Punkt: vor <div id="feedback-placeholder">
        const anchor = '<div id="feedback-placeholder"></div>';
        if (html.includes(anchor)) {
            html = html.replace(anchor, authorHTML + '\n            ' + anchor);
            injected++;
            console.log(`  ✔ ${file}`);
        } else {
            // Fallback: vor </article>
            const articleClose = '</article>';
            if (html.includes(articleClose)) {
                html = html.replace(articleClose, authorHTML + '\n        ' + articleClose);
                injected++;
                console.log(`  ✔ ${file} (Fallback: vor </article>)`);
            } else {
                skipped++;
                console.log(`  ✘ Kein Injection-Punkt in ${file}`);
                continue;
            }
        }

        writeFileSync(file, html, 'utf-8');
    }

    console.log(`\n  Autor-Box: ${injected} injiziert, ${skipped} übersprungen\n`);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Run ────────────────────────────────────────────────────

console.log('\n  📝 inject-author.js\n');
inject();
