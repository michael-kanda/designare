// ============================================================
// EVITA ANIMATIONS – Chat Sim Loop & Orbit Avatar
// Eigenständig, keine Abhängigkeiten, sauberer Teardown
// ============================================================

(function() {
    'use strict';

    // ============================================================
    // KONZEPT 02: LIVE CHAT SIMULATION
    // ============================================================
    function initChatSim() {
        const body = document.getElementById('ecsim-body');
        if (!body) return;

        const SCRIPTS = [
            [
                { who: 'evita', text: 'Guten Abend! Schön, dass du vorbeischaust.' },
                { who: 'user',  text: 'Hi! Was kannst du so?' },
                { who: 'evita', text: 'Ich kenne die ganze Website auswendig — von SEO bis Webdesign. Frag einfach drauflos.' }
            ],
            [
                { who: 'evita', text: 'Servus Alfred! Schön, dass du wieder da bist.' },
                { who: 'user',  text: 'Kannst du Michael eine E-Mail schicken?' },
                { who: 'evita', text: 'Klar. Was soll drinstehen? Ich formulier das und du gibst es frei.' }
            ],
            [
                { who: 'evita', text: 'Na, noch wach? Wobei kann ich helfen?' },
                { who: 'user',  text: 'Wie funktioniert dein Gedächtnis?' },
                { who: 'evita', text: 'Redis speichert deinen Namen und unsere Themen 30 Tage lang. Beim nächsten Besuch knüpfe ich nahtlos an.' }
            ],
            [
                { who: 'evita', text: 'Guten Morgen! Kaffee schon getrunken?' },
                { who: 'user',  text: 'Kann ich einen Rückruf buchen?' },
                { who: 'evita', text: 'Aber sicher. Ich zeig dir gleich freie Slots — Moment.' }
            ],
            [
                { who: 'evita', text: 'Hey! Wieder was zum Thema Performance?' },
                { who: 'user',  text: 'Woher weißt du das noch?' },
                { who: 'evita', text: 'Ich vergesse nichts so schnell. Das hatten wir letztes Mal besprochen.' }
            ]
        ];

        let scriptIdx = 0;
        let running = true;

        const wait = ms => new Promise(r => setTimeout(r, ms));

        function createBubble(who, text) {
            const el = document.createElement('div');
            el.className = `ecsim-bubble ${who}`;
            el.textContent = text;
            return el;
        }

        function createTyping() {
            const el = document.createElement('div');
            el.className = 'ecsim-typing';
            el.innerHTML = '<span></span><span></span><span></span>';
            return el;
        }

        function show(el) {
            el.classList.add('is-visible');
        }

        function fadeOutAll() {
            return new Promise(resolve => {
                const children = Array.from(body.children);
                if (!children.length) return resolve();

                children.forEach((ch, i) => {
                    ch.style.animation = `ecsimFadeOut 0.3s ${i * 0.05}s ease forwards`;
                });

                setTimeout(() => {
                    body.innerHTML = '';
                    resolve();
                }, 300 + children.length * 50 + 50);
            });
        }

        async function playScript(lines) {
            for (const line of lines) {
                if (!running) return;

                if (line.who === 'evita') {
                    const typing = createTyping();
                    body.appendChild(typing);
                    requestAnimationFrame(() => show(typing));
                    body.scrollTop = body.scrollHeight;

                    await wait(700 + Math.random() * 500);
                    if (!running) return;
                    typing.remove();

                    const bubble = createBubble('evita', line.text);
                    body.appendChild(bubble);
                    requestAnimationFrame(() => show(bubble));
                } else {
                    await wait(400);
                    if (!running) return;
                    const bubble = createBubble('user', line.text);
                    body.appendChild(bubble);
                    requestAnimationFrame(() => show(bubble));
                }

                body.scrollTop = body.scrollHeight;
                await wait(2000);
            }
        }

        async function loop() {
            await wait(800);
            while (running) {
                await playScript(SCRIPTS[scriptIdx]);
                if (!running) return;
                await wait(2800);
                await fadeOutAll();
                await wait(500);
                scriptIdx = (scriptIdx + 1) % SCRIPTS.length;
            }
        }

        // Klick → echten Chat öffnen
        const widget = document.getElementById('evita-chat-sim');
        if (widget) {
            function openChat() {
                const chatBtn = document.getElementById('evita-chat-button');
                if (chatBtn) chatBtn.click();
            }
            widget.addEventListener('click', openChat);
            widget.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(); }
            });
            // Cleanup-Hook
            widget._ecsimDestroy = () => { running = false; };
        }

        loop();
    }

    // ============================================================
    // KONZEPT 03: ORBIT AVATAR — Klick öffnet Chat
    // ============================================================
    function initOrbitAvatar() {
        const container = document.getElementById('eorbit-container');
        if (!container) return;

        function openChat() {
            const chatBtn = document.getElementById('evita-chat-button');
            if (chatBtn) chatBtn.click();
        }

        container.addEventListener('click', openChat);
        container.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(); }
        });
    }

    // ============================================================
    // INIT – warten auf DOM
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initChatSim();
            initOrbitAvatar();
        });
    } else {
        initChatSim();
        initOrbitAvatar();
    }
})();
