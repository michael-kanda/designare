// js/ai-form.js – Hauptmodul (Orchestrator)
// Refactored: Module statt Monolith, performanter Typewriter, Accessibility
import { createApiHandler, FallbackResponses } from './evita-api.js';
import { createBookingModal } from './evita-booking.js';
import { createEmailUI } from './evita-email-ui.js';
import { createFollowupChips } from './evita-chips.js';
import { createToolbar } from './evita-toolbar.js';

let isKeyboardListenerActive = false;

// ===================================================================
// DEPENDENCY LOADER: marked.js + DOMPurify
// ===================================================================
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
            console.warn(`⚠️ CDN-Script nicht ladbar: ${src}`);
            resolve();
        };
        document.head.appendChild(s);
    });
}

const depsReady = Promise.all([
    typeof marked === 'undefined'
        ? loadScript('https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js')
        : Promise.resolve(),
    typeof DOMPurify === 'undefined'
        ? loadScript('https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js')
        : Promise.resolve()
]);

export const initAiForm = () => {
    console.log("🚀 Initialisiere AI-Form-Modul");

    // ===================================================================
    // ZENTRALER ZUSTAND
    // ===================================================================
    const state = {
        chatHistory: [],
        selectedCallbackData: null,
        typingIndicatorId: null,
        animationRunning: false,
        apiFailureCount: 0,
        lastApiError: null,
        initialized: false,
        sessionId: null,
        userName: null,
        pendingEmailDraft: null
    };

    // ===================================================================
    // SESSION MANAGEMENT
    // ===================================================================
    const SessionManager = {
        init() {
            let sid = localStorage.getItem('evita_session_id');
            if (!sid) {
                sid = crypto.randomUUID();
                localStorage.setItem('evita_session_id', sid);
                console.log('🆕 Neue Session erstellt:', sid.substring(0, 8) + '...');
            } else {
                console.log('🔄 Bestehende Session geladen:', sid.substring(0, 8) + '...');
            }
            state.sessionId = sid;

            const savedName = localStorage.getItem('evita_user_name');
            if (savedName) {
                state.userName = savedName;
                console.log('🧠 Bekannter Name geladen:', savedName);
            }
        },
        setUserName(name) {
            if (name && name.length >= 2) {
                state.userName = name;
                localStorage.setItem('evita_user_name', name);
                console.log('🧠 Name gespeichert:', name);
            }
        },
        getUserName() { return state.userName; },
        getSessionId() { return state.sessionId; }
    };

    SessionManager.init();

    // ===================================================================
    // KEYBOARD RESIZE HANDLER (Mobile)
    // ===================================================================
    const handleKeyboardResize = () => {
        if (window.innerWidth > 768) return;
        const modalContent = document.querySelector('#ai-response-modal .modal-content');
        const chatHistory = document.getElementById('ai-chat-history');
        if (modalContent && chatHistory) {
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            modalContent.style.height = `${viewportHeight}px`;
            setTimeout(() => { chatHistory.scrollTop = chatHistory.scrollHeight; }, 100);
        }
    };

    // ===================================================================
    // MODULE INITIALISIEREN (Dependency Injection statt globaler Zustand)
    // ===================================================================
    const ApiHandler = createApiHandler(state, SessionManager);

    // ===================================================================
    // CHAT UI
    // ===================================================================
    const ChatUI = {
        addMessage(message, sender, displayImmediately = false) {
            const chatHistoryContainer = document.getElementById('ai-chat-history');
            if (!chatHistoryContainer) {
                console.warn("⚠️ Chat-History Container nicht gefunden");
                return null;
            }

            let cleanMessage = message;
            if (sender === 'ai') {
                cleanMessage = message
                    .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
                    .replace(/\[buchung_starten\]/g, '')
                    .replace(/\[booking_starten\]/g, '')
                    .replace(/\[USER_NAME:[^\]]+\]/g, '')
                    .replace(/\[EMAIL_CONFIRMED\]/g, '')
                    .replace(/\[EMAIL_DRAFT\][\s\S]*?\[\/EMAIL_DRAFT\]/g, '')
                    .trim();
            }

            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${sender}`;
            msgDiv.setAttribute('role', 'listitem');

            if (displayImmediately) {
                msgDiv.textContent = cleanMessage;
            } else {
                msgDiv.textContent = sender === 'user' ? cleanMessage : '';
            }

            chatHistoryContainer.appendChild(msgDiv);
            this.scrollToBottom();

            state.chatHistory.push({
                role: sender === 'user' ? 'user' : 'assistant',
                content: message
            });

            if (state.chatHistory.length > 20) {
                state.chatHistory = state.chatHistory.slice(-20);
            }

            return msgDiv;
        },

        showTypingIndicator() {
            this.removeTypingIndicator();
            const chatHistoryContainer = document.getElementById('ai-chat-history');
            if (!chatHistoryContainer) return;

            const indicator = document.createElement('div');
            state.typingIndicatorId = 'typing-' + Date.now();
            indicator.id = state.typingIndicatorId;
            indicator.className = 'chat-message ai';
            indicator.setAttribute('role', 'status');
            indicator.setAttribute('aria-label', 'Evita tippt...');
            indicator.innerHTML = `
                <div class="typing-dots" aria-hidden="true">
                    <span></span><span></span><span></span>
                </div>
            `;
            chatHistoryContainer.appendChild(indicator);
            this.scrollToBottom();
        },

        removeTypingIndicator() {
            if (state.typingIndicatorId) {
                const indicator = document.getElementById(state.typingIndicatorId);
                if (indicator) indicator.remove();
                state.typingIndicatorId = null;
            }
        },

        scrollToBottom() {
            const chatHistoryContainer = document.getElementById('ai-chat-history');
            if (chatHistoryContainer) {
                chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
            }
        },

        resetChat() {
            const chatHistoryContainer = document.getElementById('ai-chat-history');
            if (chatHistoryContainer) chatHistoryContainer.innerHTML = '';
            state.chatHistory = [];
            state.apiFailureCount = 0;
            state.lastApiError = null;
            state.pendingEmailDraft = null;
            console.log(`🔄 Chat zurückgesetzt (Session: ${state.sessionId?.substring(0, 8)}... | Name: ${state.userName || 'unbekannt'})`);
        }
    };

    // ===================================================================
    // MODAL CONTROLLER (mit Accessibility: Focus Trap + Escape)
    // ===================================================================
    const ModalController = {
        isProcessing: false,
        previousFocus: null,

        openChatModal() {
            const modalOverlay = document.getElementById('ai-response-modal');
            if (!modalOverlay) {
                console.error("❌ Modal nicht gefunden!");
                return;
            }

            this.previousFocus = document.activeElement;

            modalOverlay.style.display = 'flex';
            modalOverlay.setAttribute('role', 'dialog');
            modalOverlay.setAttribute('aria-modal', 'true');
            modalOverlay.setAttribute('aria-label', 'Chat mit Evita');
            document.body.classList.add('no-scroll');

            handleKeyboardResize();

            if (!isKeyboardListenerActive) {
                window.addEventListener('resize', handleKeyboardResize);
                isKeyboardListenerActive = true;
            }

            setTimeout(() => {
                modalOverlay.classList.add('visible');
                const chatInput = document.getElementById('ai-chat-input');
                if (chatInput) chatInput.focus();
                setTimeout(() => { ChatUI.scrollToBottom(); }, 400);

                // Toolbar rendern + gespeicherte Schriftgröße anwenden
                Toolbar.render();
            }, 10);
        },

        closeChatModal(force = false) {
            if (this.isProcessing && !force) {
                console.log("⚠️ Modal-Schließen blockiert - Verarbeitung läuft");
                return;
            }

            const modalOverlay = document.getElementById('ai-response-modal');
            if (!modalOverlay) return;

            modalOverlay.classList.remove('visible');

            if (isKeyboardListenerActive) {
                window.removeEventListener('resize', handleKeyboardResize);
                isKeyboardListenerActive = false;
            }

            const modalContent = document.querySelector('#ai-response-modal .modal-content');
            if (modalContent) modalContent.style.height = '';

            setTimeout(() => {
                modalOverlay.style.display = 'none';
                document.body.classList.remove('no-scroll');

                // Fullscreen zurücksetzen
                Toolbar.reset();

                if (this.previousFocus && typeof this.previousFocus.focus === 'function') {
                    this.previousFocus.focus();
                    this.previousFocus = null;
                }
            }, 300);
        },

        setupKeyboardHandlers() {
            document.addEventListener('keydown', (e) => {
                const modal = document.getElementById('ai-response-modal');
                if (!modal || !modal.classList.contains('visible')) return;

                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeChatModal(true);
                    return;
                }

                if (e.key === 'Tab') {
                    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
                    const focusableElements = modal.querySelectorAll(focusableSelector);
                    if (focusableElements.length === 0) return;

                    const firstFocusable = focusableElements[0];
                    const lastFocusable = focusableElements[focusableElements.length - 1];

                    if (e.shiftKey) {
                        if (document.activeElement === firstFocusable) {
                            e.preventDefault();
                            lastFocusable.focus();
                        }
                    } else {
                        if (document.activeElement === lastFocusable) {
                            e.preventDefault();
                            firstFocusable.focus();
                        }
                    }
                }
            });
        }
    };

    ModalController.setupKeyboardHandlers();

    // ===================================================================
    // RESTLICHE MODULE (brauchen ChatUI/ModalController)
    // ===================================================================
    const BookingModal = createBookingModal(state, ApiHandler, ModalController);
    const EmailUI = createEmailUI(state, ApiHandler, ChatUI, typeWriterEffect);
    const FollowupChips = createFollowupChips(ChatUI, BookingModal);
    const Toolbar = createToolbar(ChatUI);

    // ===================================================================
    // MARKDOWN RENDERING
    // ===================================================================
    let markedConfigured = false;

    function ensureMarkedConfigured() {
        if (markedConfigured) return;
        if (typeof marked === 'undefined') return;

        marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });

        const renderer = new marked.Renderer();
        const origLink = renderer.link.bind(renderer);
        renderer.link = function (href, title, text) {
            const html = origLink(href, title, text);
            return html.replace('<a ', '<a target="_blank" rel="noopener" ');
        };
        marked.use({ renderer });
        markedConfigured = true;
        console.log('✅ marked.js konfiguriert');
    }

    depsReady.then(() => ensureMarkedConfigured());

    function preprocessEvitaTags(text) {
        return text
            .replace(/\[LINK:([^\]|]+)\|([^\]]+)\]/g, '[$2 →]($1)')
            .replace(/\*\*E-Mail-Entwurf:\*\*/g, '<div class="evita-email-draft"><div class="email-draft-header"><strong>E-Mail-Entwurf</strong></div>');
    }

    function sanitizeHtml(html) {
        if (typeof DOMPurify === 'undefined') return html;
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'a', 'ul', 'ol', 'li',
                'code', 'pre', 'blockquote', 'h3', 'h4', 'h5', 'h6',
                'div', 'span', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style'],
            ALLOW_DATA_ATTR: false
        });
    }

    function formatMarkdown(text) {
        let processed = preprocessEvitaTags(text);
        let html;
        ensureMarkedConfigured();
        if (typeof marked !== 'undefined') {
            try { html = marked.parse(processed); }
            catch (e) { console.warn('marked.js Fehler:', e.message); html = fallbackFormat(processed); }
        } else {
            html = fallbackFormat(processed);
        }
        html = sanitizeHtml(html);
        html = html.replace(/<a /g, '<a class="evita-link" ');
        return html;
    }

    function fallbackFormat(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/^\* (.*$)/gm, '<li>$1</li>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/\n/g, '<br>');
    }

    // ===================================================================
    // TYPEWRITER EFFECT – PERFORMANCE-OPTIMIERT
    // Vorher: marked.parse() + DOMPurify.sanitize() pro WORT (N mal)
    // Jetzt:  Plaintext-Chunks animieren, Markdown EINMAL am Ende rendern
    // ===================================================================
    const TYPEWRITER_CHUNK_SIZE = 3;
    const TYPEWRITER_CHUNK_DELAY = 25;

    async function typeWriterEffect(element, text, speed = TYPEWRITER_CHUNK_DELAY) {
        if (!element) return;

        const words = text.split(' ');
        const totalWords = words.length;

        // Phase 1: Plaintext-Animation in Wort-Chunks (kein Parsing!)
        for (let i = 0; i < totalWords; i += TYPEWRITER_CHUNK_SIZE) {
            const displayedWords = Math.min(i + TYPEWRITER_CHUNK_SIZE, totalWords);
            element.textContent = words.slice(0, displayedWords).join(' ');

            const container = document.getElementById('ai-chat-history');
            if (container) container.scrollTop = container.scrollHeight;

            await new Promise(resolve => setTimeout(resolve, speed));
        }

        // Phase 2: Einmaliges Markdown-Rendering am Ende
        element.innerHTML = formatMarkdown(text);

        const container = document.getElementById('ai-chat-history');
        if (container) container.scrollTop = container.scrollHeight;
    }

    // ===================================================================
    // KERNLOGIK: Conversation Flow
    // ===================================================================
    async function handleUserMessage(userInput) {
        console.log("💬 Verarbeite User-Nachricht:", userInput);

        ModalController.isProcessing = true;

        const chatInput = document.getElementById('ai-chat-input');
        const chatForm = document.getElementById('ai-chat-form');
        const submitButton = chatForm?.querySelector('button[type="submit"]');

        if (chatInput) chatInput.disabled = true;
        if (submitButton) submitButton.disabled = true;

        ChatUI.addMessage(userInput, 'user');
        FollowupChips.remove();
        ChatUI.showTypingIndicator();

        try {
            const data = await ApiHandler.sendToEvita(userInput);
            ChatUI.removeTypingIndicator();

            if (chatInput) chatInput.disabled = false;
            if (submitButton) submitButton.disabled = false;
            if (chatInput) chatInput.focus();

            let answer = "Entschuldigung, ich konnte keine Antwort finden.";

            if (typeof data === 'string') {
                answer = data;
            } else if (data?.answer) {
                answer = data.answer;
                if (data.detectedName) SessionManager.setUserName(data.detectedName);
            } else if (data?.message) {
                answer = data.message;
            }

            const aiMsgElement = ChatUI.addMessage(answer, 'ai');
            if (aiMsgElement) {
                await typeWriterEffect(aiMsgElement, answer.trim(), TYPEWRITER_CHUNK_DELAY);
            }

            ModalController.isProcessing = false;

            if (data?.openBooking) {
                console.log('Booking via Function Call:', data.bookingReason || 'kein Grund');
                setTimeout(() => BookingModal.launch(), 800);
            }

            if (data?.emailDraft) {
                state.pendingEmailDraft = data.emailDraft;
                EmailUI.showConfirmation(data.emailDraft);
            }

            if (data?.emailSent) {
                state.pendingEmailDraft = null;
                EmailUI.hideConfirmation();
            }

            if (data?.chips && data.chips.length > 0) {
                FollowupChips.render(data.chips, aiMsgElement);
            }

        } catch (error) {
            console.error("❌ Fehler bei User-Message:", error);
            ChatUI.removeTypingIndicator();

            const fallbackAnswer = FallbackResponses.getResponse(userInput);
            const aiMsgElement = ChatUI.addMessage(fallbackAnswer, 'ai');
            if (aiMsgElement) {
                await typeWriterEffect(aiMsgElement, fallbackAnswer, TYPEWRITER_CHUNK_DELAY);
            }

            if (chatInput) chatInput.disabled = false;
            if (submitButton) submitButton.disabled = false;
            ModalController.isProcessing = false;
        }
    }

    // ===================================================================
    // WELCOME MESSAGES
    // ===================================================================
    const welcomeMessages = [
        "Hallo! Ich bin Evita, Michaels KI-Assistentin. Womit kann ich dir heute helfen?",
        "Hey! Schön, dass du da bist. Ich bin Evita – Michaels KI-Assistentin. Womit kann ich dir heute helfen?",
        "Servus! Evita hier, Michaels digitale Komplizin. Was möchtest du wissen?",
        "Hi! Ich bin Evita. Michael ist gerade beschäftigt, aber ich kann dir sicher weiterhelfen. Was liegt an?",
        "Willkommen! Ich bin Evita, Michaels digitale Komplizin. Stell mir deine Fragen!",
        "Hey, schön dich zu sehen! Ich bin Evita. Egal, ob WordPress, KI oder Kuchenrezepte – ich bin für dich da!",
        "Hi! Evita hier. Ich freue mich dich kennenzulernen – frag einfach drauf los!",
        "Grüß dich! Ich bin Evita, Michaels digitale Unterstützung. Der Hund schnarcht, Michael codet – und ich bin für dich da. Was liegt an?",
        "Servus! Evita hier. Ich bin die KI-Assistenz, Michael schreibt den Code und der Hund ist für die gute Laune zuständig. Wobei kann ich dir heute helfen?"
    ];

    const returningWelcomeMessages = [
        "Hey {name}, schön dich wiederzusehen! Was kann ich heute für dich tun?",
        "Hallo {name}! Da bist du ja wieder. Womit kann ich dir diesmal helfen?",
        "Servus {name}! Schön, dass du wieder vorbeischaust. Was liegt an?",
        "{name}! Willkommen zurück. Ich bin bereit – schieß los!",
        "Hey {name}, na, was gibt's Neues? Ich bin ganz Ohr!"
    ];

    function getWelcomeMessage() {
        const name = SessionManager.getUserName();
        if (name) {
            const msgs = returningWelcomeMessages;
            return msgs[Math.floor(Math.random() * msgs.length)].replace('{name}', name);
        }
        return welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
    }

    function openEvitaChatWithWelcome() {
        ChatUI.resetChat();
        ModalController.openChatModal();
        setTimeout(() => addWelcomeMessageToChat(), 300);
    }

    async function addWelcomeMessageToChat() {
        const chatHistory = document.getElementById('ai-chat-history');
        if (chatHistory && chatHistory.children.length === 0) {
            const randomGreeting = getWelcomeMessage();
            const msgElement = ChatUI.addMessage(randomGreeting, 'ai', false);
            if (msgElement) {
                await typeWriterEffect(msgElement, randomGreeting, TYPEWRITER_CHUNK_DELAY);
            }
        }
    }

    // ===================================================================
    // EVENT LISTENERS (keine inline onclick, keine window.* Globals)
    // ===================================================================
    function initializeEventListeners() {
        console.log("🔧 Initialisiere Event-Listener");

        const aiQuestionInput = document.getElementById('ai-question');
        if (aiQuestionInput && !aiQuestionInput.hasAttribute('data-listener-added')) {
            aiQuestionInput.setAttribute('data-listener-added', 'true');
            aiQuestionInput.addEventListener('click', (e) => { e.preventDefault(); openEvitaChatWithWelcome(); });
            aiQuestionInput.addEventListener('focus', (e) => { e.preventDefault(); aiQuestionInput.blur(); openEvitaChatWithWelcome(); });
            aiQuestionInput.addEventListener('touchstart', (e) => { e.preventDefault(); openEvitaChatWithWelcome(); }, { passive: false });
        }

        const aiForm = document.getElementById('ai-form');
        if (aiForm && !aiForm.hasAttribute('data-listener-added')) {
            aiForm.setAttribute('data-listener-added', 'true');
            aiForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const userInput = document.getElementById('ai-question')?.value?.trim();
                ChatUI.resetChat();
                ModalController.openChatModal();
                if (userInput) {
                    setTimeout(() => handleUserMessage(userInput), 150);
                    const inp = document.getElementById('ai-question');
                    if (inp) inp.value = '';
                } else {
                    setTimeout(() => addWelcomeMessageToChat(), 300);
                }
            });
        }

        const setupChatFormListener = () => {
            const chatForm = document.getElementById('ai-chat-form');
            if (chatForm && !chatForm.hasAttribute('data-listener-added')) {
                chatForm.setAttribute('data-listener-added', 'true');
                chatForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const chatInput = document.getElementById('ai-chat-input');
                    const userInput = chatInput?.value?.trim();
                    if (userInput) {
                        await handleUserMessage(userInput);
                        if (chatInput) { chatInput.value = ''; chatInput.focus(); }
                    }
                });
            }
        };

        const observer = new MutationObserver(() => setupChatFormListener());
        observer.observe(document.body, { childList: true, subtree: true });
        setupChatFormListener();

        const headerChatButton = document.getElementById('evita-chat-button');
        if (headerChatButton && !headerChatButton.hasAttribute('data-listener-added')) {
            headerChatButton.setAttribute('data-listener-added', 'true');
            headerChatButton.addEventListener('click', (e) => { e.preventDefault(); openEvitaChatWithWelcome(); });
        }

        const closeButtons = document.querySelectorAll('#close-ai-response-modal-top, #close-ai-response-modal-bottom');
        closeButtons.forEach(button => {
            if (button && !button.hasAttribute('data-listener-added')) {
                button.setAttribute('data-listener-added', 'true');
                button.addEventListener('click', () => ModalController.closeChatModal(true));
            }
        });

        const modalOverlay = document.getElementById('ai-response-modal');
        if (modalOverlay && !modalOverlay.hasAttribute('data-listener-added')) {
            modalOverlay.setAttribute('data-listener-added', 'true');
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay && e.target.classList.contains('visible')) {
                    ModalController.closeChatModal();
                }
            });
        }

        state.initialized = true;
    }

    // ===================================================================
    // GLOBALE FUNKTIONEN (nur Abwärtskompatibilität – perspektivisch entfernen)
    // ===================================================================
    window.openEvitaChat = () => openEvitaChatWithWelcome();

    // ===================================================================
    // INITIALISIERUNG
    // ===================================================================
    setTimeout(() => {
        initializeEventListeners();
        console.log("✅ AI-Form-Modul initialisiert!");
    }, 50);
};
