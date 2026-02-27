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
  }
];
