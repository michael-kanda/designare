/* generate-sitemap.js 
   Generiert sitemap.xml UND sitemap.html im public Ordner
   Mit minimalistischem Design und Close-Funktion
*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname Workaround für ES-Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. EINSTELLUNGEN
const BASE_URL = 'https://designare.at'; 
const OUTPUT_XML = path.join(__dirname, 'public', 'sitemap.xml');
const OUTPUT_HTML = path.join(__dirname, 'public', 'sitemap.html');

// Seiten, die NICHT in die Sitemap sollen
const EXCLUDE_FILES = [
    '404.html', 
    'google', 
    'side-menu.html', 
    'header.html', 
    'footer.html', 
    'modals.html', 
    'CSV-Creator.html', 
    'blog-feedback.html',
    'sitemap.html' // Sich selbst ausschließen
];

const getDate = () => new Date().toISOString().split('T')[0];

// Hilfsfunktion: Macht aus "semantisches-markup.html" -> "Semantisches Markup"
function formatTitle(filename) {
    if (filename === 'index.html') return 'Startseite';
    let name = filename.replace(/\.html$/, '');
    // Bindestriche zu Leerzeichen
    name = name.replace(/-/g, ' ');
    // Erster Buchstabe groß
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return name;
}

console.log('🤖 Starte Sitemap-Generierung (XML + HTML)...');

try {
    const files = fs.readdirSync(__dirname);
    let urls = [];

    files.forEach(file => {
        if (file.endsWith('.html') && !EXCLUDE_FILES.includes(file)) {
            // Clean URL ohne .html
            let urlPath = file === 'index.html' ? '' : file.replace(/\.html$/, '');
            
            urls.push({
                file: file, // Original Dateiname für Links in HTML Sitemap (wenn kein Clean URL Server)
                path: urlPath,
                loc: `${BASE_URL}/${urlPath}`,
                title: formatTitle(file),
                lastmod: getDate(),
                changefreq: 'weekly',
                priority: file === 'index.html' ? '1.0' : '0.8'
            });
        }
    });

    console.log(`✅ ${urls.length} Seiten gefunden.`);

    // --- TEIL A: XML GENERIEREN ---
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    // --- TEIL B: HTML GENERIEREN (Minimalistischer Stil mit Close-Funktion) ---
    const htmlContent = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sitemap | Designare.at</title>
    <meta name="description" content="Übersicht aller Seiten auf Designare.at">
    <meta name="robots" content="noindex, follow">
    <link rel="icon" href="images/favicon.webp" type="image/webp">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="css/header-footer.css">

    <style>
        /* Minimalistischer Stil passend zur Webseite */
        .sitemap-overlay {
            position: fixed;
            inset: 0;
            background: var(--bg-color, #0a0a0a);
            z-index: 1500;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .sitemap-container {
            position: relative;
            max-width: 700px;
            width: 100%;
            max-height: 85vh;
            overflow-y: auto;
            padding: 40px;
        }

        .sitemap-close {
            position: absolute;
            top: 10px;
            right: 10px;
            background: none;
            border: none;
            color: var(--text-color, #E4E4E4);
            font-size: 2rem;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.3s ease, transform 0.3s ease;
            z-index: 10;
        }

        .sitemap-close:hover {
            opacity: 1;
            transform: rotate(90deg);
        }

        .sitemap-header {
            text-align: center;
            margin-bottom: 40px;
        }

        .sitemap-header h1 {
            font-size: 1.8rem;
            font-weight: 600;
            color: var(--text-color, #E4E4E4);
            margin: 0;
        }

        .sitemap-header p {
            color: var(--text-color-muted, #949494);
            font-size: 0.95rem;
            margin-top: 8px;
        }

        .sitemap-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .sitemap-list li {
            border-bottom: 1px solid var(--border-color-subtle, #222222);
        }

        .sitemap-list li:last-child {
            border-bottom: none;
        }

        .sitemap-list a {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 18px 0;
            color: var(--text-color, #E4E4E4);
            text-decoration: none;
            transition: color 0.2s ease, padding-left 0.2s ease;
        }

        .sitemap-list a:hover {
            color: var(--accent-color, #c4a35a);
            padding-left: 10px;
        }

        .sitemap-list a i {
            color: var(--accent-color, #c4a35a);
            font-size: 1rem;
            opacity: 0.7;
            width: 20px;
            text-align: center;
            transition: opacity 0.2s ease;
        }

        .sitemap-list a:hover i {
            opacity: 1;
        }

        .sitemap-list a span {
            font-size: 1rem;
            font-weight: 400;
        }

        /* Mobile Anpassungen */
        @media (max-width: 768px) {
            .sitemap-container {
                padding: 30px 20px;
            }

            .sitemap-header h1 {
                font-size: 1.5rem;
            }

            .sitemap-list a {
                padding: 15px 0;
            }

            .sitemap-list a span {
                font-size: 0.95rem;
            }
        }
    </style>
</head>
<body class="dark-mode">

    <div class="sitemap-overlay" id="sitemap-overlay">
        <div class="sitemap-container">
            <button class="sitemap-close" id="sitemap-close" aria-label="Schließen">&times;</button>
            
            <div class="sitemap-header">
                <h1>Inhaltsverzeichnis</h1>
                <p>Alle Seiten auf einen Blick</p>
            </div>
            
            <nav aria-label="Sitemap">
                <ul class="sitemap-list">
                    ${urls.map(u => `
                    <li>
                        <a href="${u.path || 'index.html'}">
                            <i class="fa-regular fa-file-lines"></i>
                            <span>${u.title}</span>
                        </a>
                    </li>`).join('')}
                </ul>
            </nav>
        </div>
    </div>

    <script>
        // Close-Funktion
        document.addEventListener('DOMContentLoaded', function() {
            const closeBtn = document.getElementById('sitemap-close');
            const overlay = document.getElementById('sitemap-overlay');
            
            // Zurück zur vorherigen Seite oder zur Startseite
            function closeSitemap() {
                if (document.referrer && document.referrer.includes('designare.at')) {
                    history.back();
                } else {
                    window.location.href = 'index.html';
                }
            }
            
            // Click auf Close-Button
            if (closeBtn) {
                closeBtn.addEventListener('click', closeSitemap);
            }
            
            // Escape-Taste
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    closeSitemap();
                }
            });
            
            // Page loaded Klasse für Fade-in
            document.body.classList.add('page-loaded');
        });
    </script>
</body>
</html>`;

    // 4. DATEIEN SCHREIBEN
    if (!fs.existsSync(path.dirname(OUTPUT_XML))) {
        fs.mkdirSync(path.dirname(OUTPUT_XML), { recursive: true });
    }

    fs.writeFileSync(OUTPUT_XML, xmlContent);
    fs.writeFileSync(OUTPUT_HTML, htmlContent);

    console.log(`🎉 sitemap.xml UND sitemap.html erfolgreich erstellt!`);
    console.log(`📊 ${urls.length} Links verarbeitet.`);

} catch (error) {
    console.error("❌ Fehler bei der Sitemap-Generierung:", error);
    process.exit(1);
}
