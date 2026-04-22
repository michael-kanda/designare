// js/evita-greeting.js
// Greeting-Bubble: Begrüßt Besucher beim Seitenaufruf
// Liest localStorage direkt (gleiche Keys wie SessionManager in ai-form.js)
// Wird über main.js importiert und nach ai-form.js initialisiert

// ===================================================================
// CONFIG
// ===================================================================
const CONFIG = {
    showDelay: 2500,         // ms nach Aufruf von initEvitaGreeting()
    autoHideDelay: 9500,     // ms nach Typewriter-Ende
    typewriterSpeed: 30,     // ms pro Wort
    cooldownHours: 24,       // Stunden bis zur nächsten Begrüßung
    modalCheckInterval: 500, // ms zwischen Modal-Checks
    modalCheckTimeout: 15000,// ms max. Wartezeit auf Modal-Schließung
    lsKeyName: 'evita_user_name',
    lsKeySession: 'evita_session_id',
    lsKeyLastGreeting: 'evita_last_greeting',
    ssKeyGreeted: 'evita_greeted'
};

// ===================================================================
// BEGRÜSSUNGSTEXTE
// ===================================================================

// Hilfsfunktion: Tageszeit-basierte Begrüßung
function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 10) return 'Guten Morgen';
    if (hour >= 10 && hour < 13) return 'Hey';
    if (hour >= 13 && hour < 17) return 'Hallo';
    if (hour >= 17 && hour < 23) return 'Guten Abend';
    // 23–5 Uhr
    return 'Na, noch wach';
}

const firstVisitMessages = [
    "Hey! Ich bin Evita, Michaels KI-Assistentin. Wenn du was brauchst – klick einfach auf mein Bild hier oben!",
    "Servus! Ich bin Evita. Ich kenne mich hier aus – klick auf mein Bild im Header und frag einfach drauf los!",
    "Hi! Evita hier, Michaels digitale Komplizin. Du findest mich jederzeit hier oben im Header.",
    "Willkommen! Ich bin Evita. Egal ob WordPress, SEO oder Kuchenrezepte – klick oben auf mein Bild!"
];

// {greeting} wird dynamisch durch getTimeGreeting() ersetzt
const returningMessages = [
    "{greeting}, {name}! Schön, dass du wieder da bist.",
    "{greeting}, {name}! Du weißt ja, wo du mich findest.",
    "{greeting}, {name}! Brauchst du was? Ich bin hier oben für dich da.",
    "{greeting}, {name}! Was kann ich heute für dich tun?"
];

const returningNoNameMessages = [
    "{greeting}! Schön, dass du wieder da bist. Ich bin oben im Header wenn du mich brauchst.",
    "{greeting}! Du weißt ja – einfach auf mein Bild klicken.",
    "{greeting}! Brauchst du was? Klick oben auf mein Bild."
];

// ===================================================================
// HILFSFUNKTIONEN
// ===================================================================
function shouldShow() {
    if (sessionStorage.getItem(CONFIG.ssKeyGreeted)) return false;

    const lastGreeting = localStorage.getItem(CONFIG.lsKeyLastGreeting);
    if (lastGreeting) {
        const hoursSince = (Date.now() - parseInt(lastGreeting, 10)) / (1000 * 60 * 60);
        if (hoursSince < CONFIG.cooldownHours) return false;
    }

    return true;
}

function markAsShown() {
    sessionStorage.setItem(CONFIG.ssKeyGreeted, '1');
    localStorage.setItem(CONFIG.lsKeyLastGreeting, String(Date.now()));
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function pickMessage() {
    const name = localStorage.getItem(CONFIG.lsKeyName);
    const hasSession = !!localStorage.getItem(CONFIG.lsKeySession);
    const lastGreeting = localStorage.getItem(CONFIG.lsKeyLastGreeting);
    const isReturning = hasSession && !!lastGreeting;

    let pool;
    if (isReturning && name) {
        pool = returningMessages;
    } else if (isReturning) {
        pool = returningNoNameMessages;
    } else {
        pool = firstVisitMessages;
    }

    let text = pool[Math.floor(Math.random() * pool.length)];

    // Tageszeit-Begrüßung einsetzen
    text = text.replace('{greeting}', getTimeGreeting());

    if (name) {
        text = text.replace('{name}', `<span class="evita-name">${escapeHtml(name)}</span>`);
    }

    return text;
}

/**
 * Prüft ob aktuell ein Modal (Cookie-Banner, Kontaktformular etc.) offen ist.
 * Verhindert dass Greeting-Bubble gleichzeitig mit einem Modal erscheint.
 */
function isAnyModalOpen() {
    return document.querySelector('.modal-overlay.visible') !== null;
}

/**
 * Wartet bis alle Modals geschlossen sind.
 * Gibt auf nach modalCheckTimeout ms (z.B. User schließt Cookie-Banner nicht).
 * @returns {Promise<boolean>} true = Weg frei, false = Timeout
 */
function waitForModalsToClose() {
    return new Promise((resolve) => {
        // Sofort prüfen – kein Modal offen? Direkt weiter.
        if (!isAnyModalOpen()) {
            resolve(true);
            return;
        }

        console.log('⏳ Evita-Greeting wartet auf Modal-Schließung...');
        const startTime = Date.now();

        const interval = setInterval(() => {
            if (!isAnyModalOpen()) {
                clearInterval(interval);
                console.log('✅ Modal geschlossen – Greeting wird angezeigt');
                // Kurze Pause nach Modal-Schließung, damit der User nicht überrumpelt wird
                setTimeout(() => resolve(true), 800);
                return;
            }

            if (Date.now() - startTime > CONFIG.modalCheckTimeout) {
                clearInterval(interval);
                console.log('⏰ Evita-Greeting: Timeout – Modal noch offen, Greeting wird übersprungen');
                resolve(false);
            }
        }, CONFIG.modalCheckInterval);
    });
}

// ===================================================================
// TYPEWRITER
// ===================================================================
function typeWriter(element, plainText, finalHtml, speed) {
    return new Promise((resolve) => {
        const words = plainText.split(' ');
        let i = 0;

        element.classList.add('typing');

        function tick() {
            if (i < words.length) {
                i++;
                element.textContent = words.slice(0, i).join(' ');
                setTimeout(tick, speed);
            } else {
                element.classList.remove('typing');
                const parser = new DOMParser();
                const doc = parser.parseFromString(String(finalHtml || ''), 'text/html');
                // Nur Span-Markup aus dem kontrollierten Greeting zulassen.
                doc.querySelectorAll('*').forEach((node) => {
                    const tag = node.tagName.toLowerCase();
                    if (tag !== 'span') {
                        const text = document.createTextNode(node.textContent || '');
                        node.replaceWith(text);
                        return;
                    }
                    for (const attr of Array.from(node.attributes)) {
                        if (attr.name !== 'class') node.removeAttribute(attr.name);
                    }
                });
                element.innerHTML = doc.body.innerHTML;
                resolve();
            }
        }

        tick();
    });
}

// ===================================================================
// BUBBLE DOM
// ===================================================================
function createBubble() {
    const backdrop = document.createElement('div');
    backdrop.className = 'evita-greeting-backdrop';

    const bubble = document.createElement('div');
    bubble.className = 'evita-greeting-bubble';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');

    const textEl = document.createElement('span');
    textEl.className = 'evita-greeting-text';
    bubble.appendChild(textEl);

    const hintEl = document.createElement('small');
    hintEl.className = 'evita-greeting-hint';
    hintEl.textContent = 'Klick hier um den Chat zu öffnen';
    bubble.appendChild(hintEl);

    document.body.appendChild(backdrop);
    document.body.appendChild(bubble);

    return { backdrop, bubble, textEl, hintEl };
}

function dismiss(elements, openChat = false) {
    const { backdrop, bubble } = elements;

    if (bubble.classList.contains('fade-out')) return;

    bubble.classList.remove('visible');
    bubble.classList.add('fade-out');
    backdrop.classList.remove('visible');

    setTimeout(() => {
        backdrop.remove();
        bubble.remove();
    }, 400);

    if (openChat && typeof window.openEvitaChat === 'function') {
        setTimeout(() => window.openEvitaChat(), 200);
    }
}

// ===================================================================
// EXPORT: Wird von main.js aufgerufen (nach ai-form.js init)
// ===================================================================
export function initEvitaGreeting() {
    if (!shouldShow()) return;

    setTimeout(async () => {
        // Nochmal prüfen (falls Chat in der Zwischenzeit geöffnet wurde)
        if (sessionStorage.getItem(CONFIG.ssKeyGreeted)) return;

        // Evita-Avatar im Header muss existieren
        const avatar = document.getElementById('evita-chat-button');
        if (!avatar) return;

        // ── NEU: Warten bis Cookie-Banner / andere Modals geschlossen sind ──
        const canShow = await waitForModalsToClose();
        if (!canShow) return; // Timeout: Greeting überspringen

        // Nochmal prüfen nach dem Warten (könnte inzwischen Session-Greeted sein)
        if (sessionStorage.getItem(CONFIG.ssKeyGreeted)) return;

        markAsShown();

        const htmlText = pickMessage();
        const plainText = htmlText.replace(/<[^>]+>/g, '');

        const elements = createBubble();

        // Backdrop einblenden
        requestAnimationFrame(() => {
            elements.backdrop.classList.add('visible');
        });

        // Bubble einblenden
        setTimeout(() => {
            elements.bubble.classList.add('visible');
        }, 80);

        // Typewriter starten
        setTimeout(async () => {
            await typeWriter(
                elements.textEl,
                plainText,
                htmlText,
                CONFIG.typewriterSpeed
            );

            // Hint einblenden nach Typewriter
            elements.hintEl.classList.add('show');

            // Auto-Dismiss
            setTimeout(() => dismiss(elements), CONFIG.autoHideDelay);
        }, 500);

        // Click-Handler
        elements.bubble.addEventListener('click', (e) => {
            e.stopPropagation();
            dismiss(elements, true);
        });

        elements.backdrop.addEventListener('click', () => {
            dismiss(elements, false);
        });

        // Escape-Taste
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                dismiss(elements, false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

    }, CONFIG.showDelay);
}
