// lib/gemini-client.js - Gemini Modell-Konfiguration mit Fallback-Kette
// Kapselt die Google AI SDK-Interaktion
import { GoogleGenerativeAI } from "@google/generative-ai";
import { toolDeclarations } from './tool-declarations.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const COMMON_CONFIG = { temperature: 0.5 };
const TOOLS_CONFIG = { functionDeclarations: toolDeclarations };

// Modell-Kaskade: Primär → Fallback
const MODEL_CASCADE = ['gemini-2.5-flash', 'gemini-2.0-flash'];

/**
 * Generiert eine Antwort mit automatischem Modell-Fallback.
 * @param {Array} contents - Chat-History + aktuelle Nachricht
 * @param {string} systemPrompt - Dynamischer System-Prompt
 * @returns {{ response: Object, usedModel: string }}
 */
export async function generateWithFallback(contents, systemPrompt) {
  let usedModel = MODEL_CASCADE[0];

  for (let i = 0; i < MODEL_CASCADE.length; i++) {
    try {
      usedModel = MODEL_CASCADE[i];

      const model = genAI.getGenerativeModel({
        model: MODEL_CASCADE[i],
        generationConfig: COMMON_CONFIG,
        tools: [TOOLS_CONFIG],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      });

      const result = await model.generateContent({ contents });
      return { response: result.response, usedModel };

    } catch (error) {
      const isLast = i === MODEL_CASCADE.length - 1;
      console.log(`${MODEL_CASCADE[i]} failed${isLast ? '' : ', trying next'}:`, error.message);
      if (isLast) throw error;
    }
  }
}

/**
 * Sendet eine Function Response zurück an Gemini und holt die finale Antwort.
 * Wird für Tools genutzt, die Daten liefern die Gemini verarbeiten soll (z.B. Wetter).
 *
 * @param {Array} contents - Bisherige Chat-History (inkl. User-Nachricht)
 * @param {string} systemPrompt - System-Prompt
 * @param {Object} modelResponse - Die ursprüngliche Gemini-Response (mit dem functionCall)
 * @param {string} functionName - Name der aufgerufenen Funktion
 * @param {Object} functionResult - Die Daten die zurückgegeben werden
 * @param {string} usedModel - Das Modell das den ursprünglichen Call gemacht hat
 * @returns {{ response: Object, usedModel: string }}
 */
export async function generateWithFunctionResponse(contents, systemPrompt, modelResponse, functionName, functionResult, usedModel) {
  try {
    const model = genAI.getGenerativeModel({
      model: usedModel,
      generationConfig: COMMON_CONFIG,
      tools: [TOOLS_CONFIG],
      systemInstruction: { parts: [{ text: systemPrompt }] }
    });

    // Contents erweitern: bisherige History + Model-Response + Function-Response
    const extendedContents = [
      ...contents,
      // Gemini's Antwort mit dem functionCall
      {
        role: 'model',
        parts: modelResponse.candidates[0].content.parts
      },
      // Unsere Function Response
      {
        role: 'function',
        parts: [{
          functionResponse: {
            name: functionName,
            response: { result: functionResult }
          }
        }]
      }
    ];

    const result = await model.generateContent({ contents: extendedContents });
    return { response: result.response, usedModel };

  } catch (error) {
    console.error(`Function Response Fehler (${functionName}):`, error.message);
    throw error;
  }
}

/**
 * Extrahiert Text und Function Calls aus der Gemini-Response
 */
export function parseGeminiResponse(response) {
  let answerText = '';
  const functionCalls = [];

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.text) answerText += part.text;
      if (part.functionCall) functionCalls.push(part.functionCall);
    }
  }

  // Fallback: text()-Methode wenn kein Content in Candidates
  if (!answerText && functionCalls.length === 0) {
    try { answerText = response.text(); } catch (e) {}
  }

  return { answerText, functionCalls };
}

/**
 * Baut Chat-Contents aus der Frontend-History auf.
 * Bereinigt interne Tags die nicht an Gemini gehen sollen.
 *
 * Sicherheitsnetz für Context-Window:
 * - ask-gemini.js trimmt auf MAX_HISTORY_TURNS (10 Turns = 20 Einträge)
 * - Hier wird zusätzlich auf Zeichenebene begrenzt (MAX_TOTAL_CHARS)
 * - MAX_MSG_LENGTH kürzt einzelne lange Nachrichten (E-Mail-Drafts etc.)
 *
 * Bei 10 Turns × 1.500 Zeichen/Nachricht = max 30.000 theoretisch,
 * aber das Char-Budget von 20.000 greift vorher → effektiv ~13 Nachrichten.
 */
export function buildChatContents(history, userMessage) {
  const contents = [];

  const MAX_MSG_LENGTH = 1500;   // Pro Nachricht (ältere dürfen gekürzt werden)
  const MAX_TOTAL_CHARS = 20000; // Gesamt-History (~5000 Tokens)
  let totalChars = 0;

  if (history && Array.isArray(history) && history.length > 0) {
    // Nachrichten bereinigen
    const cleaned = [];
    for (const msg of history) {
      const role = msg.role === 'user' ? 'user' : 'model';
      let clean = (msg.content || '')
        .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
        .replace(/\[buchung_starten\]/g, '')
        .replace(/\[USER_NAME:[^\]]+\]/g, '')
        .replace(/\[EMAIL_DRAFT\][\s\S]*?\[\/EMAIL_DRAFT\]/g, '')
        .trim();

      if (!clean) continue;

      // Lange Nachrichten kürzen (v.a. Model-Antworten mit E-Mail-Drafts etc.)
      if (clean.length > MAX_MSG_LENGTH) {
        clean = clean.substring(0, MAX_MSG_LENGTH) + ' …';
      }

      cleaned.push({ role, text: clean, chars: clean.length });
    }

    // Von hinten (neueste) auffüllen bis Budget erschöpft
    let kept = 0;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (totalChars + cleaned[i].chars > MAX_TOTAL_CHARS) {
        console.log(`✂️ History-Content-Limit erreicht (${totalChars}/${MAX_TOTAL_CHARS} chars) – ${kept} von ${cleaned.length} Einträgen behalten`);
        break;
      }
      totalChars += cleaned[i].chars;
      kept++;
    }

    // Die letzten 'kept' Einträge in chronologischer Reihenfolge übernehmen
    const startIdx = cleaned.length - kept;
    for (let i = startIdx; i < cleaned.length; i++) {
      contents.push({ role: cleaned[i].role, parts: [{ text: cleaned[i].text }] });
    }
  }

  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  return contents;
}
