// js/evita-api.js – API-Handler + Fallback-Antworten
// Extrahiert aus ai-form.js für bessere Wartbarkeit

// ===================================================================
// FALLBACK-ANTWORTEN SYSTEM
// ===================================================================
const FallbackResponses = {
    responses: {
        greeting: [
            "Hallo! Ich bin Evita, Michaels digitale Assistentin. Gerade bin ich etwas überlastet, aber ich helfe dir trotzdem gerne! Was möchtest du wissen?",
            "Hi! Schön, dass du da bist! Mein KI-Gehirn macht gerade eine kleine Pause, aber die Basics kann ich dir trotzdem verraten.",
            "Hey! Willkommen bei designare. Ich bin Evita – aktuell im Energiesparmodus, aber für dich da!"
        ],
        contact: [
            "**Michael erreichst du am besten so:**\n\n* E-Mail: michael@designare.at\n* Oder nutze das Kontaktformular auf der Seite\n\nEr meldet sich normalerweise innerhalb von 24 Stunden!",
            "Du willst direkt mit Michael sprechen? Kein Problem!\n\n**E-Mail:** michael@designare.at\n\nFür einen Rückruf-Termin sag einfach Bescheid!"
        ],
        services: [
            "**Michaels Spezialgebiete:**\n\n* **WordPress-Entwicklung** – Custom Themes & Plugins\n* **Performance-Optimierung** – Schnelle Ladezeiten\n* **KI-Integration** – Chatbots & Automatisierung\n* **SEO** – Technische Optimierung\n\nFür Details schreib ihm eine Mail an michael@designare.at!",
            "Michael ist Web-Purist und KI-Komplize! Er macht:\n\n* Massgeschneiderte WordPress-Lösungen\n* Performance-Tuning (Core Web Vitals)\n* KI-Assistenten wie mich\n* Technisches SEO\n\nInteressiert? michael@designare.at"
        ],
        pricing: [
            "**Zu Preisen:**\n\nJedes Projekt ist individuell, daher gibt's keine Pauschalpreise. Am besten beschreibst du Michael dein Vorhaben per Mail (michael@designare.at) und er macht dir ein faires Angebot!",
            "Preise hängen vom Projektumfang ab. Michael arbeitet transparent und fair. Schreib ihm einfach, was du brauchst: michael@designare.at"
        ],
        booking: [
            "**Termin vereinbaren?**\n\nSuper Idee! Schreib Michael eine kurze Mail an michael@designare.at mit:\n* Worum geht's?\n* Wann passt es dir?\n\nEr meldet sich schnell zurück!",
            "Einen Rückruf oder Termin kannst du direkt per Mail anfragen: michael@designare.at\n\nMichael ist flexibel und findet sicher einen passenden Slot!"
        ],
        about: [
            "**Über Michael:**\n\nMichael Kanda ist Web-Purist aus Wien. Tagsüber zähmt er WordPress für maxonline Marketing, in seiner Freizeit baut er eigene Tools – wie mich!\n\nSein Motto: *Sauberer Code, kaum Wartung, smarte Lösungen.*",
            "Michael ist ein Code-Tüftler aus Wien, der WordPress liebt (fast so sehr wie seinen Hund Evita). Er entwickelt performante Websites und KI-Lösungen.\n\nMehr auf: designare.at"
        ],
        evita: [
            "**Das bin ich – Evita!**\n\nIch bin Michaels digitale Assistentin, benannt nach seinem Hund (ja, wirklich!). Ich basiere auf einer RAG-Architektur und helfe hier auf der Website.\n\nDie echte Evita ist übrigens eine Tierschutz-Export-Hundedame und die wahre Chefin!",
            "Ich bin Evita, die digitale Version! Mein Namensvetter ist ein Hund – Michaels vierbeinige Chefin. Ich bin die geduldige Variante und beantworte Fragen rund um die Uhr... naja, meistens."
        ],
        tools: [
            "**Michaels Tools:**\n\n* **DataPeak** – Sein eigenes SEO-Dashboard mit KI\n* **Silas** – Content-Generator für Keywords\n* **Evita** (das bin ich!) – KI-Assistentin\n\nAlle selbst entwickelt, weil: *Wenn's kein passendes Tool gibt, baut man es halt selbst!*"
        ],
        error: [
            "Hmm, mein KI-Gehirn stockt gerade etwas. Kannst du die Frage anders formulieren oder es gleich nochmal versuchen?",
            "Ups, da hab ich kurz gehakt! Versuch's bitte nochmal – manchmal brauche ich einen zweiten Anlauf.",
            "Entschuldige, ich bin gerade etwas verwirrt. Probier's in ein paar Sekunden noch einmal!"
        ],
        rateLimit: [
            "**Kurze Verschnaufpause!**\n\nIch bin gerade sehr gefragt und muss kurz durchatmen. Bitte versuch es in etwa einer Minute noch einmal.\n\n*Dringende Fragen? michael@designare.at*",
            "Puh, ganz schön viel los hier! Mein API-Kontingent ist kurz erschöpft. Gib mir eine Minute, dann bin ich wieder fit!\n\nOder schreib direkt an: michael@designare.at"
        ],
        default: [
            "Interessante Frage! Leider bin ich gerade im Offline-Modus und kann nicht voll antworten. Schreib Michael direkt: michael@designare.at",
            "Da müsste ich nachdenken, aber mein Gehirn macht gerade Pause. Michael kann dir sicher helfen: michael@designare.at",
            "Gute Frage! Im Moment kann ich sie nicht richtig beantworten. Am besten fragst du Michael direkt: michael@designare.at"
        ]
    },

    keywords: {
        greeting: ['hallo', 'hi', 'hey', 'guten', 'servus', 'grüß', 'moin', 'was geht', 'wie geht'],
        contact: ['kontakt', 'erreichen', 'mail', 'email', 'anrufen', 'telefon', 'schreiben', 'melden'],
        services: ['angebot', 'service', 'leistung', 'macht ihr', 'machst du', 'bietet', 'können', 'hilfe bei', 'wordpress', 'website', 'webseite', 'homepage'],
        pricing: ['preis', 'kosten', 'kostet', 'budget', 'teuer', 'günstig', 'zahlen', 'euro', 'geld'],
        booking: ['termin', 'buchung', 'buchen', 'rückruf', 'anrufen', 'sprechen', 'kontakt', 'meeting', 'appointment', 'erreichen', 'treffen', 'call', 'telefonat', 'beratung', 'projekt besprechen'],
        about: ['wer ist', 'über michael', 'michael kanda', 'wer bist', 'erzähl', 'hintergrund', 'erfahrung'],
        evita: ['evita', 'ki', 'chatbot', 'assistent', 'wie funktionierst', 'bist du', 'was bist'],
        tools: ['tool', 'datapeak', 'silas', 'dashboard', 'seo tool', 'entwickelt']
    },

    getResponse(userMessage) {
        const msg = userMessage.toLowerCase().trim();
        for (const [category, keywords] of Object.entries(this.keywords)) {
            for (const keyword of keywords) {
                if (msg.includes(keyword)) {
                    return this.getRandomFromCategory(category);
                }
            }
        }
        return this.getRandomFromCategory('default');
    },

    getRandomFromCategory(category) {
        const responses = this.responses[category] || this.responses.default;
        return responses[Math.floor(Math.random() * responses.length)];
    },

    getRateLimitResponse() {
        return this.getRandomFromCategory('rateLimit');
    },

    getErrorResponse() {
        return this.getRandomFromCategory('error');
    }
};

// ===================================================================
// API HANDLER
// ===================================================================
export function createApiHandler(state, SessionManager) {
    return {
        async safeFetch(url, options = {}) {
            console.log(`📤 API-Anfrage an: ${url}`);

            try {
                const response = await fetch(url, {
                    ...options,
                    headers: { 'Content-Type': 'application/json', ...options.headers }
                });

                console.log(`📥 Response Status: ${response.status} ${response.statusText}`);

                if (response.status === 429) {
                    console.warn("⚠️ Rate Limit erreicht!");
                    state.apiFailureCount++;
                    state.lastApiError = 'rateLimit';
                    throw new Error('RATE_LIMIT');
                }

                if (!response.ok) {
                    throw new Error(`SERVER_ERROR: ${response.status}`);
                }

                const contentType = response.headers.get('content-type');
                const responseData = contentType?.includes('application/json')
                    ? await response.json()
                    : await response.text();

                if (responseData?.rateLimited ||
                    responseData?.error?.includes?.('429') ||
                    responseData?.error?.includes?.('quota')) {
                    state.apiFailureCount++;
                    state.lastApiError = 'rateLimit';
                    throw new Error('RATE_LIMIT');
                }

                state.apiFailureCount = 0;
                state.lastApiError = null;
                return responseData;

            } catch (error) {
                console.error(`❌ API-Fehler bei ${url}:`, error);
                state.apiFailureCount++;

                if (error.message === 'RATE_LIMIT' ||
                    error.message?.includes('429') ||
                    error.message?.includes('quota') ||
                    error.message?.includes('Too Many Requests')) {
                    state.lastApiError = 'rateLimit';
                } else {
                    state.lastApiError = 'serverError';
                }

                throw error;
            }
        },

        async sendToEvita(userInput) {
            console.log("💬 Sende Nachricht an Evita:", userInput);

            if (state.apiFailureCount >= 3) {
                console.log("🔄 Zu viele API-Fehler, nutze Fallback");
                return {
                    answer: FallbackResponses.getResponse(userInput),
                    isFallback: true
                };
            }

            const requestData = {
                history: state.chatHistory,
                message: userInput,
                sessionId: SessionManager.getSessionId(),
                userName: SessionManager.getUserName(),
                currentPage: window.location.pathname
            };

            try {
                return await this.safeFetch('/api/ask-gemini', {
                    method: 'POST',
                    body: JSON.stringify(requestData)
                });
            } catch (error) {
                console.log("🔄 API fehlgeschlagen, nutze Fallback-Antwort");

                if (state.lastApiError === 'rateLimit') {
                    return {
                        answer: FallbackResponses.getRateLimitResponse(),
                        isFallback: true,
                        rateLimited: true
                    };
                }

                return {
                    answer: FallbackResponses.getResponse(userInput),
                    isFallback: true
                };
            }
        },

        getAvailableSlots() {
            return this.safeFetch('/api/suggest-appointments');
        },

        bookPhoneAppointment(bookingData) {
            return this.safeFetch('/api/book-appointment-phone', {
                method: 'POST',
                body: JSON.stringify(bookingData)
            });
        },

        bookEmailAppointment(bookingData) {
            return this.safeFetch('/api/create-appointment', {
                method: 'POST',
                body: JSON.stringify(bookingData)
            });
        },

        sendEmailConfirmation(emailDraft) {
            return this.safeFetch('/api/ask-gemini', {
                method: 'POST',
                body: JSON.stringify({
                    message: 'E-Mail senden bestätigt',
                    sessionId: SessionManager.getSessionId(),
                    userName: SessionManager.getUserName(),
                    confirmEmailSend: true,
                    pendingEmail: emailDraft,
                    history: state.chatHistory
                })
            });
        }
    };
}

export { FallbackResponses };
