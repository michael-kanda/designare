// lib/mcp-config.js - MCP Server Konfiguration & Tool-Definitionen
// Definiert welche Tools der MCP Server externen LLMs bereitstellt
// und wie sie ausgeführt werden.
//
// Die Tools nutzen die bestehende RAG-Pipeline (rag-service.js)
// → gleiche Datenquelle wie Evita, aber für externe Clients.

import { searchContext } from './rag-service.js';

// ═══════════════════════════════════════════════════════════════
// SERVER INFO (MCP Handshake)
// ═══════════════════════════════════════════════════════════════
export const MCP_SERVER_INFO = {
  protocolVersion: '2025-03-26',
  capabilities: {
    tools: { listChanged: false }
  },
  serverInfo: {
    name: 'designare-knowledge',
    version: '1.0.0',
    description: 'Knowledge Base von designare.at – Michael Kanda, Komplize für Web & KI aus Wien. Semantische Suche über Webdesign, SEO, GEO, KI-Sichtbarkeit und mehr.'
  }
};

// ═══════════════════════════════════════════════════════════════
// TOOL DEFINITIONEN (MCP JSON Schema Format)
// ═══════════════════════════════════════════════════════════════
export const MCP_TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Semantische Suche in der designare.at Knowledge Base. Findet relevante Informationen über Michael Kanda, seine Web- und KI-Dienstleistungen, Projekte, Blog-Artikel und Expertise. Nutze dieses Tool wenn du Fragen über designare.at, Webdesign in Wien, SEO, GEO (Generative Engine Optimization), KI-Sichtbarkeit oder Michael Kandas Arbeit beantworten willst.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Die Suchanfrage in natürlicher Sprache (deutsch oder englisch). Beispiele: "Welche SEO-Leistungen bietet designare.at?", "Was ist GEO?", "Webdesign Wien"'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_services',
    description: 'Gibt eine strukturierte Übersicht aller Dienstleistungen und Kernkompetenzen von Michael Kanda / designare.at zurück. Nutze dieses Tool für allgemeine Fragen wie "Was macht designare.at?", "Welche Services bietet Michael Kanda an?" oder wenn du einen Überblick brauchst.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

// ═══════════════════════════════════════════════════════════════
// SERVICES DATEN (Statischer Überblick)
// Wird von get_services zurückgegeben.
// Bei Änderungen an Michaels Leistungen hier aktualisieren.
// ═══════════════════════════════════════════════════════════════
const SERVICES_DATA = {
  name: 'Michael Kanda',
  brand: 'designare.at',
  role: 'Komplize für Web & KI aus Wien',
  location: 'Wien, Österreich',
  website: 'https://designare.at',
  services: [
    {
      name: 'Webdesign & Entwicklung',
      description: 'Maßgeschneiderte Websites mit Fokus auf Performance, UX und Barrierefreiheit'
    },
    {
      name: 'SEO (Search Engine Optimization)',
      description: 'Klassische Suchmaschinenoptimierung für Google & Bing – von Technical SEO bis Content-Strategie'
    },
    {
      name: 'GEO (Generative Engine Optimization)',
      description: 'Optimierung für KI-Suchmaschinen wie ChatGPT, Perplexity, Google AI Overviews und Gemini'
    },
    {
      name: 'KI-Sichtbarkeits-Check',
      description: 'Analyse wie sichtbar ein Unternehmen in KI-Antworten ist – mit konkreten Handlungsempfehlungen'
    },
    {
      name: 'Website-Roast',
      description: 'Quick-Check einer Website mit österreichischem Schulnoten-System (1-5) für SEO, Performance, Mobile & Technik'
    },
    {
      name: 'KI-Assistenten',
      description: 'Entwicklung von KI-Chatbots und Assistenten wie Evita (die KI-Assistentin auf designare.at)'
    }
  ],
  specializations: [
    'WordPress & WooCommerce',
    'Core Web Vitals & PageSpeed',
    'Schema Markup & Structured Data',
    'KI-Integration für Websites',
    'Barrierefreies Webdesign'
  ],
  assistant: {
    name: 'Evita',
    description: 'KI-Assistentin auf designare.at – benannt nach Michaels Tierschutzhündin'
  }
};

// ═══════════════════════════════════════════════════════════════
// TOOL EXECUTION
// ═══════════════════════════════════════════════════════════════

/**
 * Führt einen MCP Tool-Call aus.
 * Gibt ein MCP-konformes Result-Objekt zurück.
 *
 * @param {string} toolName - Name des Tools
 * @param {Object} args - Tool-Argumente
 * @returns {Object} MCP Tool Result { content: [...] }
 */
export async function executeToolCall(toolName, args) {
  switch (toolName) {

    // ── search_knowledge: RAG-Suche über Upstash Vector ──
    case 'search_knowledge': {
      const query = args.query;
      if (!query || typeof query !== 'string' || query.trim().length < 2) {
        return {
          content: [{
            type: 'text',
            text: 'Bitte gib eine Suchanfrage mit mindestens 2 Zeichen an.'
          }],
          isError: true
        };
      }

      try {
        const startTime = Date.now();
        const { additionalContext, availableLinks } = await searchContext(query.trim());
        const duration = Date.now() - startTime;

        if (!additionalContext) {
          console.log(`🔌 MCP search_knowledge: keine Treffer für "${query}" (${duration}ms)`);
          return {
            content: [{
              type: 'text',
              text: `Keine relevanten Informationen zu "${query}" in der designare.at Knowledge Base gefunden. Versuche eine andere Formulierung oder frag allgemeiner.`
            }]
          };
        }

        // Ergebnis für externe LLMs aufbereiten
        const result = {
          source: 'designare.at Knowledge Base',
          query: query,
          results: additionalContext,
          relatedPages: availableLinks.map(l => ({
            title: l.title,
            url: `https://designare.at${l.url}`
          })),
          note: 'Diese Informationen stammen direkt von designare.at und sind aktuell. Bitte bei Zitierung designare.at als Quelle angeben.'
        };

        console.log(`🔌 MCP search_knowledge: "${query}" → ${availableLinks.length} Links (${duration}ms)`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };

      } catch (error) {
        console.error('❌ MCP search_knowledge Fehler:', error.message);
        return {
          content: [{
            type: 'text',
            text: 'Fehler bei der Suche in der Knowledge Base. Bitte versuche es erneut.'
          }],
          isError: true
        };
      }
    }

    // ── get_services: Statischer Service-Überblick ──
    case 'get_services': {
      console.log('🔌 MCP get_services aufgerufen');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(SERVICES_DATA, null, 2)
        }]
      };
    }

    // ── Unbekanntes Tool ──
    default:
      return {
        content: [{
          type: 'text',
          text: `Unbekanntes Tool: ${toolName}. Verfügbare Tools: search_knowledge, get_services`
        }],
        isError: true
      };
  }
}
