// js/evita-chips.js – Follow-up Chips (Quick Suggestions)
// Extrahiert aus ai-form.js

export function createFollowupChips(ChatUI, BookingModal) {
    const FollowupChips = {
        remove() {
            document.querySelectorAll('.evita-followup-chips').forEach(el => el.remove());
        },

        render(chips, aiMsgElement) {
            if (!chips || chips.length === 0) return;
            this.remove();

            const container = document.createElement('div');
            container.className = 'evita-followup-chips';
            container.setAttribute('role', 'group');
            container.setAttribute('aria-label', 'Vorschläge');

            chips.forEach(chip => {
                if (chip.type === 'link' && chip.url) {
                    const a = document.createElement('a');
                    a.className = 'evita-followup-chip evita-chip-link';
                    a.href = chip.url;
                    a.target = '_blank';
                    a.rel = 'noopener';
                    a.innerHTML = this.esc(this.truncate(chip.text));
                    a.title = chip.text;
                    container.appendChild(a);
                } else if (chip.type === 'booking') {
                    const btn = document.createElement('button');
                    btn.className = 'evita-followup-chip';
                    btn.type = 'button';
                    btn.innerHTML = '<i class="fa-solid fa-phone" style="margin-right: 5px;" aria-hidden="true"></i> ' + this.esc(this.truncate(chip.text));
                    btn.title = chip.text;
                    btn.addEventListener('click', () => {
                        this.remove();
                        BookingModal.launch();
                    });
                    container.appendChild(btn);
                }
            });

            if (aiMsgElement) {
                aiMsgElement.appendChild(container);
            } else {
                const ch = document.getElementById('ai-chat-history');
                if (ch) ch.appendChild(container);
            }
            ChatUI.scrollToBottom();
        },

        esc(t) {
            const d = document.createElement('div');
            d.textContent = t;
            return d.innerHTML;
        },

        /** Kürzt Text auf maxWords Wörter + "…" (nur auf Mobile) */
        truncate(text, maxWords = 4) {
            if (window.innerWidth > 768) return text;
            const words = text.split(' ');
            if (words.length <= maxWords) return text;
            return words.slice(0, maxWords).join(' ') + ' …';
        }
    };

    return FollowupChips;
}
