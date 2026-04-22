// js/evita-toolbar.js – Toolbar: Fullscreen-Toggle + Schriftgröße +/−
// Wird in ai-form.js importiert und nach ModalController.openChatModal() gerendert

// ===================================================================
// CONFIG
// ===================================================================
const FONT_SIZES = [13, 14, 15, 16, 18, 20]; // px-Stufen
const DEFAULT_INDEX = 1;                       // 14px = Standard
const LS_KEY_FONT = 'evita_font_size_index';

// ===================================================================
// EXPORT
// ===================================================================
export function createToolbar(ChatUI) {
    let fontIndex = loadFontIndex();
    let isFullscreen = false;
    let toolbarEl = null;

    // ── Hilfsfunktionen ──────────────────────────────────────────────

    function loadFontIndex() {
        const saved = localStorage.getItem(LS_KEY_FONT);
        if (saved !== null) {
            const idx = parseInt(saved, 10);
            if (idx >= 0 && idx < FONT_SIZES.length) return idx;
        }
        return DEFAULT_INDEX;
    }

    function saveFontIndex(idx) {
        localStorage.setItem(LS_KEY_FONT, String(idx));
    }

    function applyFontSize() {
        const modal = document.querySelector('#ai-response-modal .modal-content');
        if (modal) {
            modal.style.setProperty('--evita-chat-font-size', FONT_SIZES[fontIndex] + 'px');
        }
        updateFontLabel();
    }

    function updateFontLabel() {
        if (!toolbarEl) return;
        const label = toolbarEl.querySelector('.evita-tb-font-label');
        if (label) label.textContent = FONT_SIZES[fontIndex] + 'px';

        const btnMinus = toolbarEl.querySelector('.evita-tb-minus');
        const btnPlus = toolbarEl.querySelector('.evita-tb-plus');
        if (btnMinus) btnMinus.disabled = (fontIndex === 0);
        if (btnPlus) btnPlus.disabled = (fontIndex === FONT_SIZES.length - 1);
    }

    function toggleFullscreen() {
        const modal = document.querySelector('#ai-response-modal .modal-content');
        if (!modal) return;

        isFullscreen = !isFullscreen;
        modal.classList.toggle('evita-fullscreen', isFullscreen);

        // Button-Icon aktualisieren
        const btn = toolbarEl?.querySelector('.evita-tb-fullscreen');
        if (btn) {
            btn.innerHTML = isFullscreen ? icons.minimize : icons.maximize;
            btn.setAttribute('aria-label', isFullscreen ? 'Vollbild beenden' : 'Vollbild');
            btn.title = isFullscreen ? 'Vollbild beenden' : 'Vollbild';
        }

        // Nach Resize scrollen
        setTimeout(() => ChatUI.scrollToBottom(), 150);
    }

    // ── SVG Icons (inline, kein externer Font nötig) ─────────────────

    const icons = {
        maximize: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4v4"/><path d="M6 14H2v-4"/><path d="M14 2L9.5 6.5"/><path d="M2 14l4.5-4.5"/></svg>',
        minimize: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10H0v4"/><path d="M12 6h4V2"/><path d="M0 14l4.5-4.5"/><path d="M16 2l-4.5 4.5"/></svg>',
        minus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 8h8"/></svg>',
        plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 4v8"/><path d="M4 8h8"/></svg>'
    };

    // ── DOM erstellen ────────────────────────────────────────────────

    function render() {
        remove(); // falls schon da

        toolbarEl = document.createElement('div');
        toolbarEl.className = 'evita-toolbar';
        toolbarEl.setAttribute('role', 'toolbar');
        toolbarEl.setAttribute('aria-label', 'Chat-Einstellungen');

        // ── Fullscreen-Button (nur Desktop) ──
        const fsBtn = document.createElement('button');
        fsBtn.className = 'evita-tb-btn evita-tb-fullscreen';
        fsBtn.type = 'button';
        fsBtn.title = 'Vollbild';
        fsBtn.setAttribute('aria-label', 'Vollbild');
        fsBtn.innerHTML = icons.maximize;
        fsBtn.addEventListener('click', toggleFullscreen);

        // ── Font-Size Gruppe ──
        const fontGroup = document.createElement('div');
        fontGroup.className = 'evita-tb-font-group';

        const fontLabel = document.createElement('span');
        fontLabel.className = 'evita-tb-font-label';
        fontLabel.setAttribute('aria-live', 'polite');

        const btnMinus = document.createElement('button');
        btnMinus.className = 'evita-tb-btn evita-tb-minus';
        btnMinus.type = 'button';
        btnMinus.title = 'Schrift kleiner';
        btnMinus.setAttribute('aria-label', 'Schrift kleiner');
        btnMinus.innerHTML = icons.minus;
        btnMinus.addEventListener('click', () => {
            if (fontIndex > 0) {
                fontIndex--;
                saveFontIndex(fontIndex);
                applyFontSize();
                ChatUI.scrollToBottom();
            }
        });

        const btnPlus = document.createElement('button');
        btnPlus.className = 'evita-tb-btn evita-tb-plus';
        btnPlus.type = 'button';
        btnPlus.title = 'Schrift größer';
        btnPlus.setAttribute('aria-label', 'Schrift größer');
        btnPlus.innerHTML = icons.plus;
        btnPlus.addEventListener('click', () => {
            if (fontIndex < FONT_SIZES.length - 1) {
                fontIndex++;
                saveFontIndex(fontIndex);
                applyFontSize();
                ChatUI.scrollToBottom();
            }
        });

        // ── "Aa" Label als visueller Hinweis ──
        const aaLabel = document.createElement('span');
        aaLabel.className = 'evita-tb-aa';
        aaLabel.textContent = 'Aa';
        aaLabel.setAttribute('aria-hidden', 'true');

        fontGroup.appendChild(btnMinus);
        fontGroup.appendChild(aaLabel);
        fontGroup.appendChild(fontLabel);
        fontGroup.appendChild(btnPlus);

        // ── Evita-Avatar (gleich wie im Header) ──
        const evitaAvatar = document.createElement('span');
        evitaAvatar.className = 'evita-tb-avatar';
        evitaAvatar.setAttribute('aria-hidden', 'true');
        const evitaImg = document.createElement('img');
        evitaImg.src = 'images/evita-ki-assistentin-button.webp';
        evitaImg.alt = 'Evita';
        evitaImg.width = 32;
        evitaImg.height = 32;
        evitaImg.loading = 'lazy';
        evitaAvatar.appendChild(evitaImg);

        toolbarEl.appendChild(evitaAvatar);
        toolbarEl.appendChild(fsBtn);
        toolbarEl.appendChild(fontGroup);

        // In modal-content einfügen (vor chat-history)
        const modalContent = document.querySelector('#ai-response-modal .modal-content');
        if (modalContent) {
            modalContent.appendChild(toolbarEl);
        }

        applyFontSize();
    }

    function remove() {
        if (toolbarEl) {
            toolbarEl.remove();
            toolbarEl = null;
        }
    }

    /** Beim Schließen des Modals: Fullscreen zurücksetzen */
    function reset() {
        if (isFullscreen) {
            const modal = document.querySelector('#ai-response-modal .modal-content');
            if (modal) modal.classList.remove('evita-fullscreen');
            isFullscreen = false;
        }
    }

    // ── Public API ───────────────────────────────────────────────────

    return {
        render,
        remove,
        reset,
        applyFontSize
    };
}
