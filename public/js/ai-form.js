// js/ai-form.js - REPARIERTE VERSION mit funktionierender Booking-Integration und mobilem Tastatur-Fix
let isKeyboardListenerActive = false;

export const initAiForm = () => {
    console.log("🚀 Initialisiere AI-Form-Modul mit Booking-Fix und Tastatur-Fix");

    // ===================================================================
    // ZENTRALER ZUSTAND (State Management)
    // ===================================================================
    const state = {
        chatHistory: [],
        selectedCallbackData: null,
        typingIndicatorId: null,
        animationRunning: false
    };

    // ===================================================================
    // DOM-ELEMENTE
    // ===================================================================
    const DOM = {
        aiForm: document.getElementById('ai-form'),
        aiQuestionInput: document.getElementById('ai-question'),
        aiStatus: document.getElementById('ai-status'),
        modalOverlay: document.getElementById('ai-response-modal'),
        closeModalButtons: document.querySelectorAll('#close-ai-response-modal-top, #close-ai-response-modal-bottom'),
        chatHistoryContainer: document.getElementById('ai-chat-history'),
        headerChatButton: document.getElementById('evita-chat-button'),
        
        get chatFormDynamic() {
            return document.getElementById('ai-chat-form');
        },
        get chatInputDynamic() {
            return document.getElementById('ai-chat-input');
        }
    };
    
    // ===================================================================
    // KEYBOARD RESIZE HANDLER - NEU
    // ===================================================================
const handleKeyboardResize = () => {
    // Nur auf Mobile-Geräten ausführen
    if (window.innerWidth > 768) return;
    
    const modalContent = document.querySelector('#ai-response-modal .modal-content');
    const chatHistory = document.getElementById('ai-chat-history');
    const chatForm = document.getElementById('ai-chat-form');
    
    if (modalContent && chatHistory && chatForm) {
        // Nutze visualViewport für bessere Tastatur-Erkennung
        if (window.visualViewport) {
            const viewportHeight = window.visualViewport.height;
            modalContent.style.height = `${viewportHeight}px`;
            
            // Scrolle zum Ende der Nachrichten
            setTimeout(() => {
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }, 100);
            
            console.log(`Viewport angepasst: ${viewportHeight}px`);
        } else {
            // Fallback für ältere Browser
            modalContent.style.height = `${window.innerHeight}px`;
        }
    }
};


    // ===================================================================
    // API HANDLER (unverändert)
    // ===================================================================
    const ApiHandler = {
        async safeFetch(url, options = {}) {
            console.log(`📤 API-Anfrage an: ${url}`);
            
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: { 'Content-Type': 'application/json', ...options.headers }
                });

                console.log(`📥 Response Status: ${response.status} ${response.statusText}`);
                
                if (!response.ok) {
                    throw new Error(`Serverfehler: ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type');
                const responseData = contentType?.includes('application/json')
                    ? await response.json()
                    : await response.text();
                
                console.log(`📋 API-Antwort erhalten:`, responseData);
                return responseData;

            } catch (error) {
                console.error(`❌ Kritischer API-Fehler bei ${url}:`, error);
                throw error;
            }
        },

        sendToEvita(userInput) {
            console.log("💬 Sende Nachricht an Evita:", userInput);
            
            // STUFE 1: Prüfe auf initiale Booking-Trigger
            const bookingTriggers = [
                'termin', 'buchung', 'buchen', 'rückruf', 'anrufen', 
                'sprechen', 'kontakt', 'meeting', 'appointment', 'erreichen'
            ];
            
            // STUFE 2: Prüfe auf Bestätigungs-Keywords (nach einer Rückfrage)
            const confirmationKeywords = [
                'ja', 'gerne', 'okay', 'ok', 'bitte', 'genau', 'richtig', 
                'korrekt', 'stimmt', 'passt', 'mach das', 'hilf mir'
            ];
            
            const hasBookingIntent = bookingTriggers.some(trigger => 
                userInput.toLowerCase().includes(trigger)
            );
            
            const hasConfirmation = confirmationKeywords.some(keyword => 
                userInput.toLowerCase().includes(keyword)
            );
            
            // Prüfe ob die letzte AI-Nachricht eine Booking-Rückfrage war
            const lastAiMessage = state.chatHistory
                .filter(msg => msg.role === 'assistant')
                .pop();
            
            const wasBookingQuestion = lastAiMessage && 
                lastAiMessage.content.includes('[BOOKING_CONFIRM_REQUEST]');
            
            console.log("🔍 Booking-Intent erkannt:", hasBookingIntent);
            console.log("🔍 Bestätigung erkannt:", hasConfirmation);
            console.log("🔍 War letzte Nachricht Booking-Frage:", wasBookingQuestion);

            // Spezielle Behandlung für Bestätigungen nach Rückfragen
            if (hasConfirmation && wasBookingQuestion) {
                console.log("✅ User hat Booking-Rückfrage bestätigt - sende Bestätigung an API");
                
                const requestData = {
                    history: state.chatHistory,
                    message: userInput,
                    checkBookingIntent: true,
                    isConfirmation: true // Flag für: "User hat Rückfrage bestätigt"
                };
                
                return this.safeFetch('/api/ask-gemini', {
                    method: 'POST',
                    body: JSON.stringify(requestData)
                });
            }

            const requestData = {
                history: state.chatHistory,
                message: userInput,
                checkBookingIntent: hasBookingIntent // Explizite Intent-Prüfung nur bei Triggern
            };
            
            return this.safeFetch('/api/ask-gemini', {
                method: 'POST',
                body: JSON.stringify(requestData)
            });
        },

        getAvailableSlots() {
            return this.safeFetch('/api/suggest-appointments');
        },
        
        bookAppointment(bookingData) {
            return this.safeFetch('/api/book-appointment-phone', {
                method: 'POST',
                body: JSON.stringify(bookingData)
            });
        }
    };

    // ===================================================================
    // CHAT UI - ERWEITERT (unverändert)
    // ===================================================================
    const ChatUI = {
        addMessage(message, sender) {
            if (!DOM.chatHistoryContainer) return;

            // WICHTIG: Entferne interne Tags aus der Chat-Anzeige
            let cleanMessage = message;
            if (sender === 'ai') {
                cleanMessage = message
                    .replace(/\[BOOKING_CONFIRM_REQUEST\]/g, '')
                    .replace(/\[buchung_starten\]/g, '')
                    .replace(/\[booking_starten\]/g, '')
                    .trim();
            }

            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${sender}`;
            msgDiv.textContent = cleanMessage; // Zeige nur die saubere Nachricht
            DOM.chatHistoryContainer.appendChild(msgDiv);
            
            this.scrollToBottom();

            // Aber speichere die Original-Nachricht in der Historie (mit Tags)
            state.chatHistory.push({ 
                role: sender === 'user' ? 'user' : 'assistant', 
                content: message // Original mit Tags für API-Kontext
            });
            
            if (state.chatHistory.length > 20) {
                state.chatHistory = state.chatHistory.slice(-20);
            }
        },

        showTypingIndicator() {
            this.removeTypingIndicator();
            if (!DOM.chatHistoryContainer) return;
            
            const indicator = document.createElement('div');
            state.typingIndicatorId = 'typing-' + Date.now();
            indicator.id = state.typingIndicatorId;
            indicator.className = 'chat-message ai';
            indicator.innerHTML = '<i>Evita tippt...</i>';
            DOM.chatHistoryContainer.appendChild(indicator);
            
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
            if (DOM.chatHistoryContainer) {
                DOM.chatHistoryContainer.scrollTop = DOM.chatHistoryContainer.scrollHeight;
            }
        },
        
        resetChat() {
            if (DOM.chatHistoryContainer) {
                DOM.chatHistoryContainer.innerHTML = '';
            }
            state.chatHistory = [];
        }
    };

    // ===================================================================
    // MODAL CONTROLLER - KORRIGIERT
    // ===================================================================
    const ModalController = {
        openChatModal() {
            if (!DOM.modalOverlay) return;
            
            DOM.modalOverlay.style.display = 'flex';
            document.body.classList.add('no-scroll');
            
            // Setze die Höhe sofort beim Öffnen
            handleKeyboardResize(); 
            
            // Füge den Listener hinzu, aber nur, wenn er noch nicht aktiv ist
            if (!isKeyboardListenerActive) {
                window.addEventListener('resize', handleKeyboardResize);
                isKeyboardListenerActive = true;
                console.log('Resize-Listener für Tastatur HINZUGEFÜGT.');
            }
            
            setTimeout(() => {
                DOM.modalOverlay.classList.add('visible');
                DOM.chatInputDynamic?.focus();
                setTimeout(() => {
                    ChatUI.scrollToBottom();
                }, 400); 
            }, 10);
        },
        
        closeChatModal() {
            if (!DOM.modalOverlay) return;
            
            DOM.modalOverlay.classList.remove('visible');
            
            // Entferne den Listener beim Schließen, um die Performance zu schonen
            if (isKeyboardListenerActive) {
                window.removeEventListener('resize', handleKeyboardResize);
                isKeyboardListenerActive = false;
                console.log('Resize-Listener für Tastatur ENTFERNT.');
            }
            
            // Setze die Höhe im CSS zurück
            const modalContent = document.querySelector('#ai-response-modal .modal-content');
            if (modalContent) {
                modalContent.style.height = ''; 
            }
            
            setTimeout(() => {
                DOM.modalOverlay.style.display = 'none';
                document.body.classList.remove('no-scroll');
            }, 300);
        }
    };

    // ===================================================================
    // BOOKING MODAL (unverändert)
    // ===================================================================
    const BookingModal = {
        async launch() {
            console.log("📞 NEUE Booking-Launch-Funktion aufgerufen");
            
            try {
                // Schließe Chat-Modal
                ModalController.closeChatModal();
                await new Promise(resolve => setTimeout(resolve, 300));

                // Entferne altes Modal
                this.remove();
                
                // Erstelle neues Modal
                const modalHTML = this.createHTML();
                document.body.insertAdjacentHTML('beforeend', modalHTML);

                const modal = document.getElementById('booking-modal');
                if (modal) {
                    modal.style.display = 'flex';
                    document.body.classList.add('no-scroll');
                    
                    this.setupEventListeners();
                    await this.loadSlots();
                    
                    console.log("✅ Booking-Modal erfolgreich geöffnet");
                } else {
                    throw new Error("Modal konnte nicht erstellt werden");
                }
            } catch (error) {
                console.error("❌ Fehler beim Öffnen des Booking-Modals:", error);
                alert("Entschuldigung, das Buchungssystem konnte nicht geladen werden. Bitte versuche es später erneut oder kontaktiere Michael direkt per E-Mail.");
            }
        },

        remove() {
            const modal = document.getElementById('booking-modal');
            if (modal) modal.remove();
            
            document.body.classList.remove('no-scroll');
            state.selectedCallbackData = null;
            console.log("✅ Booking-Modal entfernt");
        },

        createHTML() {
            return `
                <div id="booking-modal" class="booking-modal">
                    <div class="booking-modal-content">
                        <div class="booking-modal-header">
                            <h2 class="booking-modal-title">Rückruf vereinbaren</h2>
                            <p class="booking-modal-subtitle">Michael ruft dich zum gewünschten Zeitpunkt an.</p>
                        </div>
                        <div class="booking-modal-body">
                            <div id="step-slot-selection" class="booking-step active">
                                <h3 class="booking-step-title">Verfügbare Termine</h3>
                                <div id="callback-loading" style="text-align: center; padding: 20px; color: #aaa;">
                                    <div style="font-size: 1.5rem; margin-bottom: 10px;">⏳</div>
                                    Lade verfügbare Termine...
                                </div>
                                <div id="callback-slots-container" style="display: none;"></div>
                                <div id="no-slots-message" style="display: none; text-align: center; color: #aaa; padding: 20px;">
                                    Aktuell sind leider keine Rückruf-Termine verfügbar.<br>
                                    Bitte kontaktiere Michael direkt per E-Mail: 
                                    <a href="mailto:michael@designare.at" style="color: #ffc107;">michael@designare.at</a>
                                </div>
                            </div>

                            <div id="step-contact-details" class="booking-step">
                                <div id="selected-slot-display" style="text-align: center; margin-bottom: 20px; padding: 12px; background: rgba(255, 193, 7, 0.1); border: 1px solid #ffc107; border-radius: 8px; color: #ffc107;"></div>
                                <h3 class="booking-step-title">Deine Kontaktdaten</h3>
                                <form id="callback-form">
                                    <div class="booking-form-group">
                                        <label for="callback-name">Dein Name *</label>
                                        <input type="text" id="callback-name" required style="width: 100%; padding: 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; color: #f0f0f0; box-sizing: border-box;">
                                    </div>
                                    <div class="booking-form-group">
                                        <label for="callback-phone">Deine Telefonnummer *</label>
                                        <input type="tel" id="callback-phone" required placeholder="z.B. 0664 123 45 67" style="width: 100%; padding: 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; color: #f0f0f0; box-sizing: border-box;">
                                    </div>
                                    <div class="booking-form-group">
                                        <label for="callback-topic">Dein Anliegen (optional)</label>
                                        <textarea id="callback-topic" rows="3" placeholder="Worum geht es bei deinem Projekt?" style="width: 100%; padding: 12px; background: #2a2a2a; border: 1px solid #444; border-radius: 8px; color: #f0f0f0; box-sizing: border-box; resize: vertical;"></textarea>
                                    </div>
                                    <div class="booking-form-actions" style="display: flex; gap: 15px; margin-top: 20px;">
                                        <button type="button" id="back-to-slots" style="flex: 1; padding: 14px; background: #333; color: #f0f0f0; border: 1px solid #555; border-radius: 8px; cursor: pointer;">← Zurück</button>
                                        <button type="submit" id="submit-callback" style="flex: 2; padding: 14px; background: #ffc107; color: #1a1a1a; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">Rückruf buchen</button>
                                    </div>
                                </form>
                            </div>

                            <div id="step-confirmation" class="booking-step">
                                <div style="text-align: center;">
                                    <div style="font-size: 3.5rem; color: #ffc107; margin-bottom: 20px;">🎉</div>
                                    <h3 style="color: #ffffff; margin-bottom: 15px;">Termin erfolgreich gebucht!</h3>
                                    <div id="confirmation-details" style="margin: 25px 0; padding: 20px; background: #2a2a2a; border-radius: 8px; text-align: left; color: #ccc;"></div>
                    
                                <button onclick="closeCallbackModal()" style="background: #ffc107; color: #1a1a1a; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: 600;">Perfekt!</button>
                                </div>
                            </div>
                        </div>
                        <button onclick="closeCallbackModal()" style="position: absolute; top: 15px; right: 20px; background: rgba(255,255,255,0.1); border: none; color: #fff; width: 35px; height: 35px; border-radius: 50%; cursor: pointer; font-size: 1.2rem;">&times;</button>
                    </div>
                </div>
                
                <style>
                .booking-modal {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    background: rgba(10, 10, 10, 0.95) !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    z-index: 999999 !important;
                    font-family: 'Poppins', sans-serif;
                }
                .booking-modal-content {
                    background: #1e1e1e;
                    border-radius: 12px;
                    border: 1px solid #333;
                    padding: 0;
                    max-width: 500px;
                    width: 90%;
                    max-height: 90vh;
                    overflow: hidden;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                    position: relative;
                    color: #f0f0f0;
                    display: flex;
                    flex-direction: column;
                }
                .booking-modal-header {
                    padding: 24px 30px;
                    text-align: center;
                    border-bottom: 1px solid #333;
                }
                .booking-modal-title {
                    margin: 0 0 5px 0;
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: #ffffff;
                }
                .booking-modal-subtitle {
                    margin: 0;
                    color: #aaa;
                    font-size: 0.95rem;
                }
                .booking-modal-body {
                    padding: 30px;
                    overflow-y: auto;
                    flex-grow: 1;
                }
                .booking-step {
                    display: none;
                }
                .booking-step.active {
                    display: block;
                }
                .booking-step-title {
                    font-size: 1.2rem;
                    margin: 0 0 20px 0;
                    color: #ffffff;
                    text-align: center;
                }
                .callback-slot-button {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    padding: 15px 20px;
                    background: #2a2a2a;
                    border: 1px solid #444;
                    border-radius: 8px;
                    cursor: pointer;
                    text-align: left;
                    transition: all 0.2s ease;
                    color: #f0f0f0;
                    margin-bottom: 12px;
                }
                .callback-slot-button:hover {
                    border-color: #ffc107;
                    background: #333;
                }
                .booking-form-group {
                    margin-bottom: 18px;
                }
                .booking-form-group label {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 0.9rem;
                    color: #aaa;
                }
                </style>
            `;
        },

        setupEventListeners() {
            console.log("🔧 Richte Booking Event-Listener ein");

            const callbackForm = document.getElementById('callback-form');
            if (callbackForm) {
                callbackForm.addEventListener('submit', (e) => this.handleSubmit(e));
            }

            const backButton = document.getElementById('back-to-slots');
            if (backButton) {
                backButton.addEventListener('click', () => this.showStep('step-slot-selection'));
            }
        },

        async loadSlots() {
            console.log("📞 Lade verfügbare Rückruf-Termine");
            
            const loadingDiv = document.getElementById('callback-loading');
            const slotsContainer = document.getElementById('callback-slots-container');
            const noSlotsMessage = document.getElementById('no-slots-message');

            try {
                const data = await ApiHandler.getAvailableSlots();
                
                if (loadingDiv) loadingDiv.style.display = 'none';

                if (data.success && data.suggestions?.length > 0) {
                    slotsContainer.innerHTML = '';
                    slotsContainer.style.display = 'block';
                    
                    data.suggestions.forEach(suggestion => {
                        const button = document.createElement('button');
                        button.className = 'callback-slot-button';
                        button.innerHTML = `
                            <div style="flex-grow: 1;">
                                <div style="font-size: 1.1rem; font-weight: 500; color: #ffffff;">${suggestion.formattedString.split(' um ')[1]}</div>
                                <div style="font-size: 0.9rem; color: #aaa;">${suggestion.formattedString.split(' um ')[0]}</div>
                            </div>
                            <div style="font-size: 1.5rem; color: #888;">→</div>
                        `;
                        button.onclick = () => this.selectSlot(suggestion);
                        slotsContainer.appendChild(button);
                    });
                    
                    console.log(`✅ ${data.suggestions.length} Rückruf-Termine geladen`);
                } else {
                    if (noSlotsMessage) noSlotsMessage.style.display = 'block';
                    console.warn("⚠️ Keine Rückruf-Termine verfügbar");
                }
            } catch (error) {
                console.error("❌ Fehler beim Laden der Rückruf-Termine:", error);
                if (noSlotsMessage) {
                    noSlotsMessage.innerHTML = 'Fehler beim Laden der Rückruf-Termine. Bitte versuche es später erneut oder kontaktiere Michael direkt per E-Mail: <a href="mailto:michael@designare.at" style="color: #ffc107;">michael@designare.at</a>';
                    noSlotsMessage.style.display = 'block';
                }
            }
        },

        selectSlot(suggestion) {
            console.log("✅ Rückruf-Termin ausgewählt:", suggestion.formattedString);
            
            state.selectedCallbackData = suggestion;
            
            const displayElement = document.getElementById('selected-slot-display');
            if (displayElement) {
                displayElement.innerHTML = `Dein Termin: <strong>${suggestion.formattedString}</strong>`;
            }
            
            this.showStep('step-contact-details');
        },

        async handleSubmit(event) {
            event.preventDefault();
            console.log("📞 Verarbeite Rückruf-Buchungs-Formular");

            const form = event.target;
            const submitButton = form.querySelector('#submit-callback');
            const name = form.querySelector('#callback-name').value.trim();
            const phone = form.querySelector('#callback-phone').value.trim();
            const topic = form.querySelector('#callback-topic').value.trim();

            if (!name || !phone || !state.selectedCallbackData) {
                alert('Bitte fülle alle Pflichtfelder aus.');
                return;
            }

            submitButton.disabled = true;
            submitButton.textContent = 'Wird gebucht...';

            try {
                const data = await ApiHandler.bookAppointment({
                    slot: state.selectedCallbackData.fullDateTime,
                    name, 
                    phone, 
                    topic
                });

                if (data.success) {
                    const confirmationDetails = document.getElementById('confirmation-details');
                    if (confirmationDetails) {
                        confirmationDetails.innerHTML = `
    <div><strong>Termin:</strong> ${state.selectedCallbackData.formattedString}</div>
    <div><strong>Name:</strong> ${name}</div>
    <div><strong>Telefon:</strong> ${phone}</div>
    ${topic ? `<div><strong>Anliegen:</strong> ${topic}</div>` : ''}
    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #444; color: #aaa; font-size: 0.9rem;">
        Michael wird dich zum vereinbarten Zeitpunkt anrufen. Halte dein Telefon bitte bereit.
    </div>
                        `;
                    }
                    this.showStep('step-confirmation');
                    console.log("✅ Rückruf-Buchung erfolgreich!");
                } else {
                    throw new Error(data.message || 'Unbekannter Rückruf-Buchungsfehler');
                }
            } catch (error) {
                console.error("❌ Rückruf-Booking-Fehler:", error);
                alert(`Rückruf-Buchung fehlgeschlagen: ${error.message}`);
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Rückruf buchen';
            }
        },

        showStep(stepId) {
            document.querySelectorAll('.booking-step').forEach(step => step.classList.remove('active'));
            const targetStep = document.getElementById(stepId);
            if (targetStep) targetStep.classList.add('active');
            
            console.log("📋 Zeige Schritt:", stepId);
        }
    };

    // ===================================================================
    // KERNLOGIK: Conversation Flow - ERWEITERT (unverändert)
    // ===================================================================
    async function handleUserMessage(userInput) {
        console.log("💬 Verarbeite User-Nachricht:", userInput);

        const chatInput = DOM.chatInputDynamic;
        const submitButton = DOM.chatFormDynamic?.querySelector('button[type="submit"]');

        // Deaktiviere das Formular, um doppelte Eingaben zu verhindern
        if (chatInput) chatInput.disabled = true;
        if (submitButton) submitButton.disabled = true;

        ChatUI.addMessage(userInput, 'user');
        ChatUI.showTypingIndicator();

        try {
            // ZUERST die letzte AI-Nachricht aus der Historie holen, BEVOR eine neue hinzugefügt wird.
            const lastAiMessageBeforeReply = state.chatHistory
                .filter(msg => msg.role === 'assistant')
                .pop();
            const wasBookingQuestion = lastAiMessageBeforeReply &&
                lastAiMessageBeforeReply.content.includes('[BOOKING_CONFIRM_REQUEST]');

            const data = await ApiHandler.sendToEvita(userInput);
            ChatUI.removeTypingIndicator();

            let answer = "Entschuldigung, ich konnte keine passende Antwort finden.";

            // Verbesserte Antwort-Extraktion
            if (typeof data === 'string') {
                answer = data;
            } else if (data?.answer) {
                answer = data.answer;
            } else if (data?.message) {
                answer = data.message;
            }

            console.log("🤖 Evita-Antwort:", answer.substring(0, 100) + "...");

            // JETZT die neue Antwort hinzufügen
            ChatUI.addMessage(answer, 'ai');

            const isBookingConfirmRequest = answer.includes('[BOOKING_CONFIRM_REQUEST]');

            // Die Prüfung `wasBookingQuestion` wurde bereits oben durchgeführt.
            const shouldLaunchAfterConfirmation = wasBookingQuestion && (
                answer.includes('[buchung_starten]') ||
                answer.includes('[booking_starten]')
            );

            console.log("🔍 Antwort-Analyse:");
            console.log("   - Ist Rückfrage:", isBookingConfirmRequest);
            console.log("   - War vorher schon Rückfrage:", wasBookingQuestion);
            console.log("   - Launch nach Bestätigung:", shouldLaunchAfterConfirmation);
            console.log("   - Chat-Historie Länge:", state.chatHistory.length);

            if (shouldLaunchAfterConfirmation) {
                console.log("🎯 Launch nach Bestätigung erkannt - starte Modal in 800ms");
                setTimeout(() => {
                    BookingModal.launch();
                }, 800);
            } else if (isBookingConfirmRequest) {
                console.log("🤔 Erste Booking-Rückfrage gestellt - KEIN Modal-Launch");
                // Hier passiert NICHTS - nur die Rückfrage wird angezeigt
            } else {
                console.log("ℹ️ Normale Antwort ohne Booking-Bezug");
            }

        } catch (error) {
            console.error("❌ Fehler bei User-Message:", error);
            ChatUI.removeTypingIndicator();
            ChatUI.addMessage(`Entschuldigung, es ist ein technischer Fehler aufgetreten: ${error.message}`, 'ai');
        } finally {
            // Aktiviere das Formular wieder, egal ob Erfolg oder Fehler
            if (chatInput) {
                chatInput.disabled = false;
                chatInput.focus();
            }
            if (submitButton) {
                submitButton.disabled = false;
            }
        }
    }

    // ===================================================================
    // EVENT LISTENERS SETUP (unverändert)
    // ===================================================================
    function initializeEventListeners() {
        console.log("🔧 Initialisiere Event-Listener");

        // Haupt-Formular auf der Startseite
        if (DOM.aiForm) {
            DOM.aiForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const userInput = DOM.aiQuestionInput.value.trim();
                if (userInput) {
                    ChatUI.resetChat();
                    ModalController.openChatModal();
                    handleUserMessage(userInput);
                    DOM.aiQuestionInput.value = '';
                }
            });
        }

        // Chat-Formular im Modal (dynamisch)
        const setupChatFormListener = () => {
            const chatForm = DOM.chatFormDynamic;
            if (chatForm && !chatForm.hasAttribute('data-listener-added')) {
                chatForm.setAttribute('data-listener-added', 'true');
                chatForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const chatInput = DOM.chatInputDynamic;
                    const userInput = chatInput?.value.trim();
                    if (userInput) {
                        await handleUserMessage(userInput);
                        chatInput.value = '';
                        chatInput.focus();
                    }
                });
            }
        };

        // Observer für dynamisches Chat-Formular
        const observer = new MutationObserver(setupChatFormListener);
        observer.observe(document.body, { childList: true, subtree: true });

        // Header-Chat-Button
        if (DOM.headerChatButton) {
            DOM.headerChatButton.addEventListener('click', (e) => {
                e.preventDefault();
                ChatUI.resetChat();
                ChatUI.addMessage("Hallo! Ich bin Evita, Michaels KI-Assistentin. Womit kann ich dir heute helfen?", 'ai');
                ModalController.openChatModal();
            });
        }

        // Modal schließen
        DOM.closeModalButtons.forEach(button => {
            button.addEventListener('click', ModalController.closeChatModal);
        });

        if (DOM.modalOverlay) {
            DOM.modalOverlay.addEventListener('click', (e) => {
                if (e.target === DOM.modalOverlay) {
                    ModalController.closeChatModal();
                }
            });
        }

        console.log("✅ Event-Listener erfolgreich initialisiert");
    }

    // ===================================================================
    // GLOBALE FUNKTIONEN (unverändert)
    // ===================================================================
    window.closeCallbackModal = () => BookingModal.remove();
    window.launchBookingFromChat = () => BookingModal.launch();

    // Test-Funktion für Debug
    if (window.location.search.includes('debug=true')) {
        window.debugBookingLaunch = () => {
            console.log("🔧 DEBUG: Manueller Booking-Launch");
            BookingModal.launch();
        };
    }

    // ===================================================================
    // INITIALISIERUNG
    // ===================================================================
    initializeEventListeners();
    console.log("✅ AI-Form-Modul mit funktionierender Booking-Integration initialisiert!");
}
