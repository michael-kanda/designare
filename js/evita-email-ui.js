// js/evita-email-ui.js – E-Mail-Entwurf-UI
// Extrahiert aus ai-form.js

export function createEmailUI(state, ApiHandler, ChatUI, typeWriterEffect) {
    const EmailUI = {
        showConfirmation(draft) {
            this.hideConfirmation();

            const chatHistory = document.getElementById('ai-chat-history');
            if (!chatHistory) return;

            const bar = document.createElement('div');
            bar.id = 'evita-email-confirm';
            bar.className = 'evita-email-confirm';
            bar.setAttribute('role', 'alert');
            bar.setAttribute('aria-live', 'assertive');
            bar.innerHTML = `
                <div class="email-confirm-info">
                    <span>E-Mail an <strong>${this.escapeHtml(draft.to)}</strong> bereit</span>
                </div>
                <div class="email-confirm-actions">
                    <button class="btn-email-send" id="btn-email-send" aria-label="E-Mail absenden">Absenden</button>
                    <button class="btn-email-edit" id="btn-email-edit" aria-label="E-Mail-Entwurf ändern">Ändern</button>
                    <button class="btn-email-cancel" id="btn-email-cancel" aria-label="E-Mail-Entwurf verwerfen">&times;</button>
                </div>
            `;

            const chatForm = document.getElementById('ai-chat-form');
            if (chatForm) {
                chatForm.parentElement.insertBefore(bar, chatForm);
            } else {
                chatHistory.parentElement.appendChild(bar);
            }

            // Event Listener (keine globalen window.* Funktionen mehr)
            document.getElementById('btn-email-send')?.addEventListener('click', () => this.confirmSend());
            document.getElementById('btn-email-edit')?.addEventListener('click', () => this.editDraft());
            document.getElementById('btn-email-cancel')?.addEventListener('click', () => this.cancelDraft());

            ChatUI.scrollToBottom();
        },

        hideConfirmation() {
            const bar = document.getElementById('evita-email-confirm');
            if (bar) bar.remove();
        },

        async confirmSend() {
            if (!state.pendingEmailDraft) return;

            const btn = document.getElementById('btn-email-send');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Wird gesendet...';
            }

            try {
                const data = await ApiHandler.sendEmailConfirmation(state.pendingEmailDraft);

                let answer = data?.answer || 'E-Mail wurde verarbeitet.';

                const aiMsgElement = ChatUI.addMessage(answer, 'ai');
                if (aiMsgElement) {
                    await typeWriterEffect(aiMsgElement, answer, 25);
                }

                if (data?.emailSent) {
                    state.pendingEmailDraft = null;
                    this.hideConfirmation();
                } else {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = 'Absenden';
                    }
                }
            } catch (error) {
                console.error('📧 E-Mail-Versand fehlgeschlagen:', error);
                const errMsg = 'Ups, beim Senden ist etwas schiefgelaufen. Versuch es bitte nochmal.';
                const aiMsgElement = ChatUI.addMessage(errMsg, 'ai');
                if (aiMsgElement) {
                    await typeWriterEffect(aiMsgElement, errMsg, 25);
                }
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Absenden';
                }
            }
        },

        editDraft() {
            this.hideConfirmation();
            const chatInput = document.getElementById('ai-chat-input');
            if (chatInput) {
                chatInput.focus();
                chatInput.placeholder = 'Was soll geändert werden?';
            }
        },

        cancelDraft() {
            state.pendingEmailDraft = null;
            this.hideConfirmation();

            const msg = 'Alles klar, E-Mail verworfen.';
            const aiMsgElement = ChatUI.addMessage(msg, 'ai');
            if (aiMsgElement) {
                typeWriterEffect(aiMsgElement, msg, 25);
            }
        },

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    return EmailUI;
}
