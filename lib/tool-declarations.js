// lib/tool-declarations.js - Gemini Function Calling Schema
// Definiert welche Tools Evita nutzen kann
import { FunctionDeclarationSchemaType } from "@google/generative-ai";

export const toolDeclarations = [
  {
    name: "open_booking",
    description: "Öffnet den Buchungskalender für einen Rückruf-Termin mit Michael. Aufrufen wenn der Nutzer einen Termin, Rückruf, Call oder ein Meeting mit Michael möchte.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        reason: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Kurzer Grund für den Termin (optional)"
        }
      }
    }
  },
  {
    name: "compose_email",
    description: "Verfasst und versendet eine E-Mail für den Nutzer. Das ist ein allgemeiner E-Mail-Service. Aufrufen wenn der Nutzer eine E-Mail senden, schreiben oder verfassen möchte. IMMER alle Pflichtfelder ausfüllen.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        to: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "E-Mail-Adresse des Empfängers"
        },
        to_name: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Name des Empfängers (optional)"
        },
        subject: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Betreff der E-Mail"
        },
        body: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Vollständiger E-Mail-Text inklusive Anrede und Grußformel."
        }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "remember_user_name",
    description: "Speichert den Vornamen des Nutzers wenn er sich vorstellt oder seinen Namen nennt.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        name: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Vorname des Nutzers"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "suggest_chips",
    description: "Zeigt dem Nutzer klickbare Link-Vorschläge unter der Antwort. IMMER aufrufen. Max 2 interne Links. KEINE doppelten Links. KEINE Fragen mehr generieren.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        chips: {
          type: FunctionDeclarationSchemaType.ARRAY,
          items: {
            type: FunctionDeclarationSchemaType.OBJECT,
            properties: {
              type: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "Immer 'link' für einen internen Link"
              },
              text: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "Der Seitentitel (max 6 Wörter)"
              },
              url: {
                type: FunctionDeclarationSchemaType.STRING,
                description: "URL-Pfad, z.B. '/ki-sichtbarkeit'"
              }
            },
            required: ["type", "text", "url"]
          },
          description: "Liste von internen Links."
        }
      },
      required: ["chips"]
    }
  },
  {
    name: "get_weather",
    description: "Ruft aktuelle Wetterdaten für eine Stadt ab. NUR aufrufen wenn der Nutzer EXPLIZIT nach dem Wetter fragt (z.B. 'Wie ist das Wetter?', 'Wie warm ist es in Salzburg?'). Für Wien ist der aktuelle Wetter-Kontext bereits im System-Prompt – nutze ihn für beiläufige Kommentare OHNE dieses Tool. Bei anderen Städten immer dieses Tool verwenden.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        city: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Name der Stadt (z.B. 'Wien', 'Salzburg', 'Graz', 'Berlin'). Default: Wien."
        }
      }
    }
  },
  {
    name: "website_roast",
    description: "Analysiert eine Website und erstellt einen frechen Quick-Check mit österreichischer Schulnote (1-5). Aufrufen wenn der Nutzer eine URL zum Checken, Analysieren oder Roasten schickt, oder nach 'Website-Check', 'Seite analysieren', 'check mal', 'wie ist meine Seite' fragt. Auch aufrufen wenn der Nutzer einfach eine URL oder Domain als Nachricht schickt.",
    parameters: {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: {
        url: {
          type: FunctionDeclarationSchemaType.STRING,
          description: "Die URL oder Domain der Website die analysiert werden soll (z.B. 'designare.at', 'https://example.com')"
        }
      },
      required: ["url"]
    }
  }
];
