# designare.at

> Source-Code von [designare.at](https://designare.at) – der persönlichen Web- & KI-Spielwiese von **Michael Kanda**, Komplize für Web & KI aus Wien.

Keine Agentur-Seite, kein Sales-Funnel, sondern ein technischer Freiraum für Code-Experimente, eigene Tools und Fachartikel rund um WordPress-Performance, technisches SEO, GEO (Generative Engine Optimization), Schema.org, Serverless-Architekturen und KI-Integration.

---

## Inhaltsverzeichnis

- [Über das Projekt](#über-das-projekt)
- [Features](#features)
- [Tech-Stack](#tech-stack)
- [Projektstruktur](#projektstruktur)
- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Build-Prozess](#build-prozess)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Cron Jobs](#cron-jobs)
- [Tests](#tests)
- [MCP Server](#mcp-server)
- [Lizenz & Kontakt](#lizenz--kontakt)

---

## Über das Projekt

`designare` ist eine hybride Site:

- **Statisches Frontend** aus klassischen HTML-/CSS-/JS-Dateien, gebündelt über einen eigenen Build-Runner und Gulp.
- **Serverless Backend** als Vercel Functions (`/api/*`) für KI-Features, Booking, Mail, MCP, Tracking und mehr.
- **RAG-Pipeline** für die KI-Assistentin **Evita** (Gemini Embedding + Upstash Vector + Redis Memory).
- **Eigener MCP-Server** unter `https://designare.at/api/mcp` (registriert als `at.designare/knowledge` in der offiziellen MCP Registry).

Alle Inhalte sind auf Deutsch (`de-AT`).

---

## Features

| Bereich | Beschreibung |
|---|---|
| **KI-Assistentin Evita** | RAG-basierter Chatbot mit Gemini-Backend, Vektorsuche und persistentem Memory |
| **MCP Server** | Streamable-HTTP-Endpoint mit Tools `search_knowledge` und `get_services` |
| **KI-Sichtbarkeits-Check** | Live-Tool, das prüft, ob eine Website von ChatGPT, Gemini & Co. als Quelle genutzt wird |
| **Website-Roast** | Automatisierte SEO-/Performance-Analyse mit österreichischem Notensystem |
| **Booking-System** | Terminbuchung über Google Calendar API mit Mail-Bestätigung via Brevo |
| **DataPeak Dashboard** | KI-gestütztes SEO-Dashboard, das GSC- und GA4-Daten zusammenführt |
| **Knowledge Base** | Auto-generierte JSON-Wissensdatenbank aus allen Artikeln (`knowledge.json`) |
| **Schema.org Automation** | JSON-LD-Injektion, Ratings-, FAQ- und Breadcrumb-Sync |
| **Build-Pipeline** | CSS-Bundling, Sitemap-Generierung, Lazy-Loading-Injektion, Header-/Footer-Sync |

---

## Tech-Stack

**Runtime & Hosting**
- Node.js **22.x**
- Vercel (Serverless Functions + Static Hosting)
- ES Modules (`"type": "module"`)

**Core Dependencies**
- [`@google/generative-ai`](https://www.npmjs.com/package/@google/generative-ai) – Gemini-Backend für Evita & MCP
- [`@upstash/redis`](https://upstash.com/) & [`@upstash/vector`](https://upstash.com/) – Memory & Vektordatenbank
- [`@supabase/supabase-js`](https://supabase.com/) – persistente Daten
- [`@getbrevo/brevo`](https://www.brevo.com/) – Transaktionsmails
- [`googleapis`](https://www.npmjs.com/package/googleapis) – Calendar / GSC / GA4
- [`cheerio`](https://cheerio.js.org/) – HTML-Parsing für Build-Skripte
- [`rss-parser`](https://www.npmjs.com/package/rss-parser) – News-Feeds
- [`qrcode`](https://www.npmjs.com/package/qrcode) – QR-Generierung

**Build & Test**
- [`gulp`](https://gulpjs.com/) + `gulp-clean-css` + `gulp-concat` – CSS-Bundling
- [`vitest`](https://vitest.dev/) – Unit-Tests

---

## Projektstruktur

```
designare/
├── api/                     # Vercel Serverless Functions
│   ├── cron/                # Tägliche/stündliche Cron-Endpoints
│   ├── tools/               # Tool-Endpoints (z. B. website-roast)
│   ├── mcp.js               # MCP Server (JSON-RPC über Streamable HTTP)
│   ├── evita-*.js           # KI-Assistentin Evita
│   ├── ai-visibility-*.js   # KI-Sichtbarkeits-Check
│   └── ...
├── lib/                     # Shared Backend-Module (RAG, Mail, Validation, …)
├── css/                     # Source-Stylesheets (werden gebündelt)
├── js/                      # Frontend-JS + Build-Skripte (inject-*.js, build-runner.js)
├── images/                  # Bilder (Source)
├── font/, Font/             # Webfonts (Poppins)
├── tests/                   # Vitest-Tests + Mocks
├── public/                  # Build-Output (von Vercel deployed)
├── *.html                   # Source-Seiten (Startseite, Artikel, Tools)
├── articles-db.json         # Auto-generierte Artikel-Datenbank
├── knowledge.json           # Auto-generierte Wissensbasis (für RAG)
├── llms.txt                 # Maschinenlesbarer Site-Index für LLMs
├── server.json              # MCP-Registry-Manifest
├── vercel.json              # Vercel-Config + Cron-Jobs
└── package.json
```

---

## Voraussetzungen

- **Node.js 22.x** (siehe `engines` in `package.json`)
- **npm** (oder kompatibler Package-Manager)
- Optional für vollen Funktionsumfang: Accounts bei Vercel, Upstash, Supabase, Brevo und Google Cloud (siehe [Environment Variables](#environment-variables))

---

## Installation

```bash
git clone https://github.com/michael-kanda/designare.git
cd designare
npm install
```

---

## Build-Prozess

Der Build wird über einen modularen Runner gesteuert (`js/build-runner.js`):

```bash
npm run build
```

Der Runner führt sequenziell folgende Schritte aus:

1. **Generierung** – `articles-db.json`, `knowledge.json`, `sitemap.xml`
2. **Ratings & FAQs** injizieren
3. **Assets kopieren** nach `public/`
4. **CSS bündeln** über Gulp (`npm run bundle-css`)
5. **Sequenzielle Injektionen** – Theme-Init, Header, Footer, Modals, Side-Menu, Breadcrumbs, Related, Autor-Box, Blog-Artikel, Lazy-Loading, Consent
6. **Build-Log** schreiben

Einzelne Steps lassen sich über die jeweiligen npm-Scripts isoliert aufrufen, z. B.:

```bash
npm run generate-knowledge
npm run generate-sitemap
npm run inject:header
npm run bundle-css
```

---

## Lokale Entwicklung

Da die Site statisches HTML + Serverless Functions kombiniert, empfiehlt sich die Vercel CLI:

```bash
npm install -g vercel
vercel dev
```

Das startet das Frontend aus `public/` und exponiert die `/api/*`-Endpoints lokal mit aktivem ENV-Loading (über `.env.local`).

Reine Frontend-Vorschau ohne API geht auch über jeden Static-Server, z. B.:

```bash
npx serve public
```

---

## Environment Variables

Sensible Keys werden über `.env.local` (lokal) bzw. die Vercel Project Environment Variables (Production) gesetzt. Die wichtigsten Variablen:

| Variable | Zweck |
|---|---|
| `GEMINI_API_KEY` | Google Generative AI (Evita, MCP, Fact-Checker) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Memory / Rate-Limiting |
| `UPSTASH_VECTOR_REST_URL` / `UPSTASH_VECTOR_REST_TOKEN` | Vektordatenbank für RAG |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Persistente Daten |
| `BREVO_API_KEY` | Mailversand (Bestätigungen, Reports) |
| `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_CALENDAR_ID` | Booking via Google Calendar |
| `CRON_SECRET` | Schutz der Cron-Endpoints |

> **Hinweis:** Es liegt bewusst keine `.env.example` im Repo. Welche Keys eine konkrete Function benötigt, lässt sich am einfachsten direkt im Code unter `api/` und `lib/` nachschlagen.

---

## Deployment

Deployment erfolgt automatisch über **Vercel** (siehe `vercel.json`):

- `buildCommand`: `npm run build`
- `outputDirectory`: `public`
- `cleanUrls: true`, `trailingSlash: false`
- Serverless Functions aus `/api/*`

Push auf den Default-Branch triggert ein Production-Deployment.

---

## Cron Jobs

Definiert in `vercel.json`:

| Schedule (UTC) | Endpoint | Zweck |
|---|---|---|
| `0 3 * * *` | `/api/cron-rebuild` | Nächtlicher Re-Build |
| `30 3 * * *` | `/api/cron/regenerate-knowledge` | Knowledge Base + Vector DB synchronisieren |
| `0 5,17 * * *` | `/api/cron/fetch-news` | News-Feeds aktualisieren |
| `0 * * * *` | `/api/cron/health-check` | Stündlicher Health-Check |

---

## Tests

Tests laufen mit **Vitest**:

```bash
npx vitest         # Watch-Mode
npx vitest run     # einmalig
```

Abgedeckte Module u. a.:
- `email-service`
- `memory-service`
- `prompt-builder`
- `rate-limiter`
- `tool-handlers`
- `validation`

Mocks liegen unter `tests/__mocks__/`.

---

## MCP Server

`designare.at` betreibt einen eigenen **Model Context Protocol Server** für direkten LLM-Zugriff auf die Knowledge Base – ohne Umweg über klassische Crawler.

- **Endpoint:** `https://designare.at/api/mcp` (Streamable HTTP, JSON-RPC)
- **Registry-Eintrag:** `at.designare/knowledge` (DNS-verifiziert)
- **Manifest:** [`server.json`](./server.json)
- **Tools:**
  - `search_knowledge` – semantische Suche über die gesamte Knowledge Base (Gemini Embedding + Upstash Vector)
  - `get_services` – strukturiertes JSON mit allen Services und Spezialisierungen
- **Aktualität:** Vector DB wird nächtlich um 03:30 UTC per Cron synchronisiert

Mehr dazu: [designare.at/mcp-server](https://designare.at/mcp-server.html)

---

## Lizenz & Kontakt

Dieses Repository enthält den Source-Code einer **persönlichen Website** und ist primär als Referenz/Showcase gedacht. Eine offene Lizenz wurde bislang nicht hinterlegt – Inhalte (Texte, Bilder, Branding) sind urheberrechtlich geschützt.

Für eigene Nutzung einzelner Code-Snippets bitte vorher kurz Rücksprache halten.

**Michael Kanda** – Komplize für Web & KI aus Wien

- Website: [designare.at](https://designare.at)
- Entity Page: [designare.at/michael-kanda](https://designare.at/michael-kanda.html)
- GitHub: [@michael-kanda](https://github.com/michael-kanda/)
- LinkedIn: [michael-kanda](https://www.linkedin.com/in/michael-kanda-408910341/)
- WordPress.org: [michaelmedientechnik](https://profiles.wordpress.org/michaelmedientechnik/)
- Wikidata: [Q138818463](https://www.wikidata.org/wiki/Q138818463)
