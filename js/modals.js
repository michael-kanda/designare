// js/modals.js - Bereinigt & Korrigiert

export const openModal = (modalElement) => {
    if (modalElement) {
        modalElement.classList.add('visible');
        document.body.style.overflow = 'hidden';
        document.body.classList.add('no-scroll');
    }
};

export const closeModal = (modalElement) => {
    if (modalElement) {
        modalElement.classList.remove('visible');
        document.body.style.overflow = '';
        document.body.classList.remove('no-scroll');
    }
};

function sanitizeHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');

    doc.querySelectorAll('script, iframe, object, embed').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
            } else if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
                el.removeAttribute(attr.name);
            }
        }
    });

    return doc.body.innerHTML;
}

// Wird von ai-form.js aufgerufen
export function showAIResponse(content, isHTML = false) {
    const modal = document.getElementById('ai-response-modal');
    const contentArea = document.getElementById('ai-chat-history');

    if (modal && contentArea) {
        if (isHTML) {
            contentArea.innerHTML = sanitizeHtml(content);
        } else {
            contentArea.textContent = content;
        }
        openModal(modal);
    }
}

// ===================================================================
// COOKIE MODAL SETUP (Bereinigt für Consent Mode v2)
// ===================================================================
function setupCookieModal() {
    const cookieInfoButton = document.getElementById('cookie-info-button');

    // Das automatische Öffnen und die alten Buttons wurden entfernt.
    // consent-banner.js kümmert sich jetzt um die Logik und das Einblenden.

    // Falls du auf der Seite noch einen Button (z.B. im Footer) mit der ID "cookie-info-button" hast, 
    // leiten wir den Klick jetzt sauber an den neuen Consent Manager weiter:
    if (cookieInfoButton) {
        cookieInfoButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.ConsentManager) {
                window.ConsentManager.showSettings();
            }
        });
    }
}

// ===================================================================
// KONTAKT MODAL SETUP
// ===================================================================
function setupContactModal() {
    const contactModal = document.getElementById('contact-modal');
    const contactButton = document.getElementById('contact-button');
    const closeModalBtn = document.getElementById('close-modal');
    const contactForm = document.getElementById('contact-form-inner');
    const contactSuccessMessage = document.getElementById('contact-success-message');
    const closeSuccessBtn = document.getElementById('close-success-message');

    if (contactButton) {
        contactButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (contactModal) {
                contactForm.style.display = 'block';
                contactSuccessMessage.classList.remove('contact-success-visible');
                contactSuccessMessage.classList.add('contact-success-hidden');
                openModal(contactModal);
            }
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => closeModal(contactModal));
    }

    if (closeSuccessBtn) {
        closeSuccessBtn.addEventListener('click', (e) => {
            e.preventDefault();
            closeModal(contactModal);
        });
    }

    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitButton = contactForm.querySelector('button[type="submit"]');

            submitButton.disabled = true;
            submitButton.textContent = 'Wird gesendet...';

            try {
                const formData = new FormData(contactForm);
                const data = Object.fromEntries(formData.entries());

                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    throw new Error(`Server-Fehler: ${response.status} ${response.statusText}`);
                }

                const result = await response.json();

                if (result.success) {
                    contactForm.style.display = 'none';
                    contactSuccessMessage.classList.remove('contact-success-hidden');
                    contactSuccessMessage.classList.add('contact-success-visible');
                    contactForm.reset();
                } else {
                    throw new Error(result.message || 'Unbekannter Fehler');
                }
            } catch (error) {
                console.error('Fehler beim Senden:', error);
                alert('Fehler beim Senden. Bitte später erneut versuchen.');
            } finally {
                submitButton.disabled = false;
                submitButton.textContent = 'Ab die Post!';
            }
        });
    }
}

// ===================================================================
// LEGAL CONTENT LOADER
// ===================================================================
function loadLegalContentWithPagination(page) {
    console.log('📄 Lade Legal Content:', page);

    const legalModal = document.getElementById('legal-modal');
    const contentArea = document.getElementById('legal-modal-content-area');

    if (!legalModal || !contentArea) return;

    contentArea.innerHTML = '<div style="text-align: center; padding: 40px;"><p>Lade Inhalt...</p></div>';
    openModal(legalModal);

    fetch(page)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const mainContent = doc.querySelector('main .legal-container')
                || doc.querySelector('.legal-container')
                || doc.querySelector('main')
                || doc.querySelector('body');

            if (mainContent) {
                contentArea.style.opacity = '0';
                contentArea.innerHTML = sanitizeHtml(mainContent.innerHTML);
                addPaginationButtons(contentArea, page);
                requestAnimationFrame(() => {
                    contentArea.style.opacity = '1';
                });
            } else {
                throw new Error('Inhalt nicht extrahierbar');
            }
        })
        .catch(error => {
            console.error('Fehler:', error);
            contentArea.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <h3>Fehler</h3>
                    <p>Konnte Inhalt nicht laden.</p>
                    <button onclick="window.location.href='${page}'" class="cta-button">Seite direkt öffnen</button>
                </div>
            `;
        });
}

// ===================================================================
// LEGAL PAGINATION
// ===================================================================
function addPaginationButtons(contentArea, currentPage) {
    const pageConfigs = {
        'datenschutz.html': {
            totalPages: 3,
            pages: [
                { title: 'Seite 1: Grundlagen & Rechte', sections: [0, 1] },
                { title: 'Seite 2: Datenverarbeitung', sections: [2, 3] },
                { title: 'Seite 3: Cookies & KI', sections: [4, 6] }
            ]
        },
        'impressum.html': {
            totalPages: 2,
            pages: [
                { title: 'Seite 1: Kontakt & Grundlagen', sections: [0, 2] },
                { title: 'Seite 2: Haftungsausschluss', sections: [3, 5] }
            ]
        },
        'disclaimer.html': {
            totalPages: 2,
            pages: [
                { title: 'Seite 1: Abgrenzung & Urheberrecht', sections: [0, 1] },
                { title: 'Seite 2: Haftungsausschluss', sections: [2, 3] }
            ]
        }
    };

    const config = pageConfigs[currentPage];
    if (!config) return;

    const paginationState = {
        currentPage: 0,
        pages: config.pages
    };

    function createPaginationHTML(pageIndex) {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === config.totalPages - 1;
        return `
            <div class="legal-modal-pagination-buttons">
                <button id="legal-prev-btn" ${isFirstPage ? 'disabled' : ''}>\u2190 ${isFirstPage ? 'Erste' : 'Vorherige'}</button>
                <span style="color: var(--text-color); font-weight: 500; padding: 10px; text-align: center; font-size: 0.9rem;">
                    ${paginationState.pages[pageIndex].title}<br>
                    <small style="opacity: 0.7;">(${pageIndex + 1}/${config.totalPages})</small>
                </span>
                <button id="legal-next-btn" ${isLastPage ? 'disabled' : ''}>${isLastPage ? 'Letzte' : 'Nächste'} \u2192</button>
            </div>`;
    }

    function updatePagination() {
        const existing = contentArea.querySelector('.legal-modal-pagination-buttons');
        if (existing) existing.remove();
        contentArea.insertAdjacentHTML('beforeend', createPaginationHTML(paginationState.currentPage));

        const prevBtn = document.getElementById('legal-prev-btn');
        const nextBtn = document.getElementById('legal-next-btn');

        if (prevBtn && !prevBtn.disabled) {
            prevBtn.addEventListener('click', () => {
                if (paginationState.currentPage > 0) {
                    paginationState.currentPage--;
                    showPage(paginationState.currentPage);
                }
            });
        }
        if (nextBtn && !nextBtn.disabled) {
            nextBtn.addEventListener('click', () => {
                if (paginationState.currentPage < config.totalPages - 1) {
                    paginationState.currentPage++;
                    showPage(paginationState.currentPage);
                }
            });
        }
    }

    function showPage(pageIndex) {
        const allElements = contentArea.querySelectorAll('h1, h2, h3, h4, p, ul, ol, li, div:not(.legal-modal-pagination-buttons)');
        allElements.forEach(el => el.style.display = 'none');

        const title = contentArea.querySelector('h1');
        if (title) title.style.display = 'block';

        if (currentPage === 'impressum.html') handleImpressumPagination(pageIndex);
        else if (currentPage === 'disclaimer.html') handleDisclaimerPagination(pageIndex);
        else if (currentPage === 'datenschutz.html') handleDatenschutzPagination(pageIndex);

        updatePagination();
        contentArea.scrollTop = 0;
    }

    function handleImpressumPagination(pageIndex) {
        const h3Elements = Array.from(contentArea.querySelectorAll('h3'));
        if (pageIndex === 0) showH3SectionsRange(h3Elements, 0, 2);
        else if (pageIndex === 1) showH3SectionsRange(h3Elements, 3, h3Elements.length - 1);
    }

    function handleDisclaimerPagination(pageIndex) {
        const h3Elements = Array.from(contentArea.querySelectorAll('h3'));
        if (pageIndex === 0) showH3SectionsRange(h3Elements, 0, 1);
        else if (pageIndex === 1) showH3SectionsRange(h3Elements, 2, h3Elements.length - 1);
    }

    function handleDatenschutzPagination(pageIndex) {
        const standInfo = contentArea.querySelector('p');
        if (standInfo && standInfo.textContent.includes('Stand:')) standInfo.style.display = 'block';

        const h3Elements = Array.from(contentArea.querySelectorAll('h3'));
        const pageConfig = paginationState.pages[pageIndex];
        if (pageConfig.sections) showH3SectionsRange(h3Elements, pageConfig.sections[0], pageConfig.sections[1]);
    }

    function showH3SectionsRange(h3Elements, startIndex, endIndex) {
        for (let i = startIndex; i <= endIndex && i < h3Elements.length; i++) {
            const h3 = h3Elements[i];
            h3.style.display = 'block';
            let nextElement = h3.nextElementSibling;
            while (nextElement && nextElement.tagName !== 'H3') {
                if (!nextElement.classList.contains('legal-modal-pagination-buttons')) {
                    nextElement.style.display = 'block';
                }
                nextElement = nextElement.nextElementSibling;
            }
        }
    }

    showPage(0);
}

// ===================================================================
// AI MODAL CLOSE
// ===================================================================
function setupAiModal() {
    const aiResponseModal = document.getElementById('ai-response-modal');
    const closeButtons = [
        document.getElementById('close-ai-response-modal-top'),
        document.getElementById('close-ai-response-modal-bottom')
    ];
    closeButtons.forEach(btn => {
        if (btn) btn.addEventListener('click', () => closeModal(aiResponseModal));
    });
}

// ===================================================================
// UTILS
// ===================================================================
function setupModalBackgroundClose() {
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeModal(e.target);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const visibleModal = document.querySelector('.modal-overlay.visible');
            if (visibleModal) closeModal(visibleModal);
        }
    });
}

function setupLegalModalCloseButton() {
    const legalModal = document.getElementById('legal-modal');
    const closeLegalModalBtn = document.getElementById('close-legal-modal');
    if (closeLegalModalBtn) {
        closeLegalModalBtn.addEventListener('click', () => closeModal(legalModal));
    }
}

// ===================================================================
// INIT
// ===================================================================
export function initModals() {
    console.log('🚀 Initialisiere Modals...');

    setTimeout(() => {
        setupCookieModal();
        setupContactModal();
        setupAiModal();
        setupLegalModalCloseButton();
        setupModalBackgroundClose();

        console.log('✅ Modals bereit');
    }, 100);
}
