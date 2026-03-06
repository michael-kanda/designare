// js/evita-booking.js – Booking-Modal Modul
// Extrahiert aus ai-form.js

export function createBookingModal(state, ApiHandler, ModalController) {
    const BookingModal = {
        async launch() {
            console.log("📞 Booking-Modal wird geöffnet");

            try {
                ModalController.closeChatModal(true);
                await new Promise(resolve => setTimeout(resolve, 300)); // Warten auf Modal-Close-Animation

                this.remove();

                const modalHTML = this.createHTML();
                document.body.insertAdjacentHTML('beforeend', modalHTML);

                const modal = document.getElementById('booking-modal');
                if (modal) {
                    modal.style.display = 'flex';
                    document.body.classList.add('no-scroll');

                    // Accessibility: Focus trapping + initial focus
                    this.setupFocusTrap(modal);
                    this.setupEventListeners();
                    await this.loadSlots();
                }
            } catch (error) {
                console.error("❌ Fehler beim Öffnen des Booking-Modals:", error);
                alert("Das Buchungssystem konnte nicht geladen werden. Bitte kontaktiere Michael direkt: michael@designare.at");
            }
        },

        remove(reopenChat = false) {
            const modal = document.getElementById('booking-modal');
            if (modal) modal.remove();

            document.body.classList.remove('no-scroll');
            state.selectedCallbackData = null;

            // Chat-Lightbox wieder öffnen (außer bei internem Cleanup)
            if (reopenChat) {
                setTimeout(() => ModalController.openChatModal(), 150);
            }
        },

        createHTML() {
            return `
                <div id="booking-modal" class="booking-modal" role="dialog" aria-modal="true" aria-label="Rückruf vereinbaren">
                    <div class="booking-modal-content">
                        <button class="booking-modal-close-btn" id="booking-close-btn" aria-label="Dialog schließen">&times;</button>
                        <div class="booking-modal-header">
                            <h2 class="booking-modal-title" id="booking-modal-title">Rückruf vereinbaren</h2>
                            <p class="booking-modal-subtitle">Michael ruft dich zum gewünschten Zeitpunkt an.</p>
                        </div>
                        <div class="booking-modal-body">
                            <div id="step-slot-selection" class="booking-step active">
                                <h3 class="booking-step-title">Verfügbare Termine</h3>
                                <div id="callback-loading" role="status" aria-live="polite">
                                    Lade verfügbare Termine...
                                </div>
                                <div id="callback-slots-container" style="display: none;" role="list" aria-label="Verfügbare Termine"></div>
                                <div id="no-slots-message" style="display: none;" role="alert">
                                    Aktuell sind keine Termine verfügbar.<br>
                                    <a href="mailto:michael@designare.at">michael@designare.at</a>
                                </div>
                            </div>

                            <div id="step-contact-details" class="booking-step">
                                <div id="selected-slot-display" aria-live="polite"></div>
                                <h3 class="booking-step-title">Deine Kontaktdaten</h3>
                                <form id="callback-form" novalidate>
                                    <div class="booking-form-group">
                                        <label for="callback-name">Dein Name *</label>
                                        <input type="text" id="callback-name" required autocomplete="name" aria-required="true">
                                    </div>
                                    <div class="booking-form-group">
                                        <label for="callback-phone">Telefonnummer *</label>
                                        <input type="tel" id="callback-phone" required placeholder="z.B. 0664 123 45 67" autocomplete="tel" aria-required="true">
                                    </div>
                                    <div class="booking-form-group">
                                        <label for="callback-topic">Anliegen (optional)</label>
                                        <textarea id="callback-topic" rows="3" placeholder="Worum geht es?"></textarea>
                                    </div>
                                    <div class="booking-form-actions">
                                        <button type="button" id="back-to-slots" class="booking-btn back-btn">← Zurück</button>
                                        <button type="submit" id="submit-callback" class="booking-btn submit-btn">Rückruf buchen</button>
                                    </div>
                                </form>
                            </div>

                            <div id="step-confirmation" class="booking-step" role="alert">
                                <div class="confirmation-content">
                                    <h3 class="confirmation-title">Termin gebucht!</h3>
                                    <div id="confirmation-details"></div>
                                    <button id="booking-confirm-close" class="booking-btn confirm-close-btn">Perfekt!</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        },

        setupEventListeners() {
            const callbackForm = document.getElementById('callback-form');
            if (callbackForm) {
                callbackForm.addEventListener('submit', (e) => this.handleSubmit(e));
            }

            const backButton = document.getElementById('back-to-slots');
            if (backButton) {
                backButton.addEventListener('click', () => this.showStep('step-slot-selection'));
            }

            // Close-Button (kein inline onclick mehr)
            const closeBtn = document.getElementById('booking-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.remove(true));
            }

            // Confirm-Close-Button
            const confirmCloseBtn = document.getElementById('booking-confirm-close');
            if (confirmCloseBtn) {
                confirmCloseBtn.addEventListener('click', () => this.remove(true));
            }

            // Accessibility: Escape zum Schließen
            const modal = document.getElementById('booking-modal');
            if (modal) {
                modal.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.remove(true);
                    }
                });
            }
        },

        // Accessibility: Focus Trap innerhalb des Modals
        setupFocusTrap(modal) {
            const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

            modal.addEventListener('keydown', (e) => {
                if (e.key !== 'Tab') return;

                const focusableElements = modal.querySelectorAll(focusableSelector);
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
            });

            // Initiales Focus auf den Close-Button
            const closeBtn = modal.querySelector('.booking-modal-close-btn');
            if (closeBtn) setTimeout(() => closeBtn.focus(), 100);
        },

        async loadSlots() {
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
                        button.setAttribute('role', 'listitem');
                        button.setAttribute('aria-label', `Termin: ${suggestion.formattedString}`);
                        button.innerHTML = `
                            <div style="flex-grow: 1;">
                                <div style="font-weight: 500;">${suggestion.formattedString.split(' um ')[1]}</div>
                                <div style="font-size: 0.9rem; opacity: 0.7;">${suggestion.formattedString.split(' um ')[0]}</div>
                            </div>
                            <div style="font-size: 1.5rem;" aria-hidden="true">→</div>
                        `;
                        button.onclick = () => this.selectSlot(suggestion);
                        slotsContainer.appendChild(button);
                    });
                } else {
                    if (noSlotsMessage) noSlotsMessage.style.display = 'block';
                }
            } catch (error) {
                console.error("❌ Fehler beim Laden der Termine:", error);
                if (loadingDiv) loadingDiv.style.display = 'none';
                if (noSlotsMessage) {
                    noSlotsMessage.innerHTML = 'Termine konnten nicht geladen werden.<br><a href="mailto:michael@designare.at" style="color: var(--accent-color);">michael@designare.at</a>';
                    noSlotsMessage.style.display = 'block';
                }
            }
        },

        selectSlot(suggestion) {
            state.selectedCallbackData = suggestion;

            const displayElement = document.getElementById('selected-slot-display');
            if (displayElement) {
                displayElement.innerHTML = `<strong>${suggestion.formattedString}</strong>`;
            }

            this.showStep('step-contact-details');

            // Focus auf erstes Formularfeld
            setTimeout(() => {
                const nameInput = document.getElementById('callback-name');
                if (nameInput) nameInput.focus();
            }, 100);
        },

        async handleSubmit(event) {
            event.preventDefault();

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
                const data = await ApiHandler.bookPhoneAppointment({
                    slot: state.selectedCallbackData.fullDateTime,
                    name,
                    phone,
                    topic
                });

                if (data.success) {
                    const confirmationDetails = document.getElementById('confirmation-details');
                    if (confirmationDetails) {
                        let html = `
                            <p><strong>Termin:</strong> ${data.appointmentDetails?.formattedDate || state.selectedCallbackData.formattedString}</p>
                            <p><strong>Uhrzeit:</strong> ${data.appointmentDetails?.formattedTime || ''}</p>
                            <p><strong>Name:</strong> ${name}</p>
                            <p><strong>Telefon:</strong> ${phone}</p>
                            ${topic ? `<p><strong>Anliegen:</strong> ${topic}</p>` : ''}
                        `;

                        html += `<div class="calendar-save-section">`;

                        if (data.qrCode) {
                            html += `
                                <div class="qr-code-wrapper">
                                    <img src="${data.qrCode}" alt="Termin QR-Code – scannen zum Speichern im Kalender" class="qr-code-image" />
                                    <p class="qr-code-hint">QR-Code scannen</p>
                                </div>
                            `;
                        }

                        if (data.icsContent) {
                            const icsBlob = new Blob([data.icsContent], { type: 'text/calendar;charset=utf-8' });
                            const icsUrl = URL.createObjectURL(icsBlob);
                            html += `
                                <a href="${icsUrl}" download="rueckruf-designare.ics" class="ics-download-btn">
                                    Im Kalender speichern
                                </a>
                            `;
                        }

                        html += `</div>`;
                        confirmationDetails.innerHTML = html;
                    }
                    this.showStep('step-confirmation');
                } else {
                    throw new Error(data.message || 'Buchung fehlgeschlagen');
                }
            } catch (error) {
                console.error("❌ Booking-Fehler:", error);
                alert(`Buchung fehlgeschlagen: ${error.message}`);
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Rückruf buchen';
            }
        },

        showStep(stepId) {
            document.querySelectorAll('.booking-step').forEach(step => step.classList.remove('active'));
            const targetStep = document.getElementById(stepId);
            if (targetStep) targetStep.classList.add('active');
        }
    };

    return BookingModal;
}
