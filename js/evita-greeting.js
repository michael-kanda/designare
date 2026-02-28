// js/evita-greeting.js
// Standalone Greeting-Bubble: Begrüßt Besucher beim Seitenaufruf
// Liest localStorage direkt (gleiche Keys wie SessionManager in ai-form.js)
// Keine Imports, keine Abhängigkeiten – kann unabhängig geladen werden

(function () {
    'use strict';

    // ===================================================================
    // CONFIG
    // ===================================================================
    const CONFIG = {
        showDelay: 2500,         // ms nach Seitenload
        autoHideDelay: 5000,     // ms nach Typewriter-Ende
        typewriterSpeed: 30,     // ms pro Wort
        cooldownHours: 24,       // Stunden bis zur nächsten Begrüßung
        lsKeyName: 'evita_user_name',
        lsKeySession: 'evita_session_id',
        lsKeyLastGreeting: 'evita_last_greeting',
        ssKeyGreeted: 'evita_greeted'
    };

    // ===================================================================
    // BEGRÜSSUNGSTEXTE
    // ===================================================================
    const firstVisitMessages = [
        "Hey! Ich bin Evita, Michaels KI-Assistentin. Wenn du was brauchst – klick einfach auf mein Bild hier oben!",
        "Servus! Ich bin Evita. Ich kenne mich hier aus – klick auf mein Bild im Header und frag einfach drauf los!",
        "Hi! Evita hier, Michaels digitale Komplizin. Du findest mich jederzeit hier oben im Header.",
        "Willkommen! Ich bin Evita. Egal ob WordPress, SEO oder Kuchenrezepte – klick oben auf mein Bild!"
    ];

    const returningMessages = [
        "Hey {name}, schön dich wiederzusehen! Du weißt ja, wo du mich findest 😊",
        "Servus {name}! Na, was gibt's Neues? Ich bin wie immer hier oben für dich da.",
        "{name}! Willkommen zurück. Klick auf mein Bild wenn ich dir helfen kann!",
        "Hallo {name}! Schön, dass du wieder da bist."
    ];

    const returningNoNameMessages = [
        "Hey, schön dich wiederzusehen! Ich bin oben im Header wenn du mich brauchst.",
        "Willkommen zurück! Du weißt ja – einfach auf mein Bild klicken.",
        "Na, wieder da? Ich freu mich! Klick oben auf mein Bild wenn du was brauchst."
    ];

    // ===================================================================
    // LOGIK: Soll die Bubble angezeigt werden?
    // ===================================================================
    function shouldShow() {
        // Schon begrüßt in dieser Browser-Session
        if (sessionStorage.getItem(CONFIG.ssKeyGreeted)) return false;

        // Cooldown: Letzte Begrüßung weniger als X Stunden her
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

    // ===================================================================
    // TEXT AUSWÄHLEN
    // ===================================================================
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
        if (name) {
            text = text.replace('{name}', `<span class="evita-name">${escapeHtml(name)}</span>`);
        }

        return { text, hasHtml: !!name };
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ===================================================================
    // TYPEWRITER (arbeitet mit plaintext, setzt HTML am Ende)
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
                    // Finales HTML mit farbigen Namen etc.
                    element.innerHTML = finalHtml;
                    resolve();
                }
            }

            tick();
        });
    }

    // ===================================================================
    // BUBBLE ERSTELLEN & ZEIGEN
    // ===================================================================
    function createBubble() {
        // Backdrop (klick-anywhere-to-dismiss)
        const backdrop = document.createElement('div');
        backdrop.className = 'evita-greeting-backdrop';

        // Bubble
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

        // Bereits am Ausblenden?
        if (bubble.classList.contains('fade-out')) return;

        bubble.classList.remove('visible');
        bubble.classList.add('fade-out');
        backdrop.classList.remove('visible');

        setTimeout(() => {
            backdrop.remove();
            bubble.remove();
        }, 400);

        if (openChat && typeof window.openEvitaChat === 'function') {
            // Kurzer Delay damit die Bubble erst verschwindet
            setTimeout(() => window.openEvitaChat(), 200);
        }
    }

    // ===================================================================
    // HAUPTFUNKTION
    // ===================================================================
    function init() {
        if (!shouldShow()) return;

        // Warte auf DOM + delay
        const trigger = () => {
            setTimeout(async () => {
                // Nochmal prüfen (falls Chat in der Zwischenzeit geöffnet wurde)
                if (sessionStorage.getItem(CONFIG.ssKeyGreeted)) return;

                // Evita-Avatar im Header muss existieren
                const avatar = document.getElementById('evita-chat-button');
                if (!avatar) return;

                markAsShown();

                const { text: htmlText, hasHtml } = pickMessage();
                // Plaintext-Version für Typewriter (HTML-Tags entfernen)
                const plainText = htmlText.replace(/<[^>]+>/g, '');

                const elements = createBubble();

                // Backdrop einblenden
                requestAnimationFrame(() => {
                    elements.backdrop.classList.add('visible');
                });

                // Bubble einblenden (kleiner Versatz für Staffelung)
                setTimeout(() => {
                    elements.bubble.classList.add('visible');
                }, 80);

                // Typewriter starten (nach Bubble sichtbar)
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
                    dismiss(elements, true); // true = Chat öffnen
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
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', trigger);
        } else {
            trigger();
        }
    }

    // Los geht's
    init();

})();
