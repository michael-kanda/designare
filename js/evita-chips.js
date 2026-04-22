// js/evita-chips.js – Follow-up Chips (Quick Suggestions)
// Extrahiert aus ai-form.js

// ===================================================================
// BLOCKLIST: URLs die NIE als Chip erscheinen dürfen
// Wird sowohl gegen absolute (https://designare.at/...) als auch
// relative (/michael-kanda) Pfade geprüft, case-insensitive,
// mit/ohne Trailing-Slash, mit/ohne Hash & Query.
// ===================================================================
const BLOCKED_CHIP_URLS = [
    'https://designare.at/michael-kanda'
];

/** Normalisiert URLs für robusten Vergleich */
function normalizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let u = url.trim().toLowerCase();
    u = u.split('#')[0].split('?')[0];
    u = u.replace(/\.(html?|php|aspx?)$/i, '');   // ← NEU
    if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1);
    return u;
}

/** Prüft ob eine Chip-URL geblockt ist (absolut ODER relativ matched) */
function isChipUrlBlocked(url) {
    const target = normalizeUrl(url);
    if (!target) return false;

    return BLOCKED_CHIP_URLS.some(blocked => {
        const b = normalizeUrl(blocked);
        if (target === b) return true;
        // Auch relativen Pfad matchen (z.B. "/michael-kanda" matched "https://designare.at/michael-kanda")
        try {
            const blockedPath = new URL(b).pathname.replace(/\/$/, '');
            const targetPath = target.startsWith('http')
                ? new URL(target).pathname.replace(/\/$/, '')
                : target.replace(/\/$/, '');
            return blockedPath === targetPath;
        } catch {
            return false;
        }
    });
}

export function createFollowupChips(ChatUI, BookingModal) {
    const FollowupChips = {
        remove() {
            document.querySelectorAll('.evita-followup-chips').forEach(el => el.remove());
        },

        render(chips, aiMsgElement) {
            if (!chips || chips.length === 0) return;

            // ── BLOCKLIST-FILTER: geblockte Link-Chips rauswerfen ──
            const filtered = chips.filter(chip => {
                if (chip.type === 'link' && isChipUrlBlocked(chip.url)) {
                    console.log(`🚫 Chip geblockt: ${chip.url}`);
                    return false;
                }
                return true;
            });

            if (filtered.length === 0) return;
            this.remove();

            const container = document.createElement('div');
            container.className = 'evita-followup-chips';
            container.setAttribute('role', 'group');
            container.setAttribute('aria-label', 'Vorschläge');

            filtered.forEach(chip => {
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
