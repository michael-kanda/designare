// js/modals.js - FINAL (Inkl. Suche, Über Mich & Evita)

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

// Diese Funktion wird von `ai-form.js` aufgerufen
export function showAIResponse(content, isHTML = false) {
    const modal = document.getElementById('ai-response-modal');
    const contentArea = document.getElementById('ai-chat-history');

    if (modal && contentArea) {
        if (isHTML) {
            contentArea.innerHTML = content;
        } else {
            contentArea.textContent = content;
        }
        openModal(modal);
    }
}

// ===================================================================
// HILFSFUNKTION: ÜBER MICH MODAL ÖFFNEN
// ===================================================================
function openAboutMeModal() {
    const legalModal = document.getElementById('legal-modal');
    const aboutContent = document.getElementById('about-me-content');
    const contentArea = document.getElementById('legal-modal-content-area');

    if (legalModal && aboutContent && contentArea) {
        console.log('👤 Öffne Über Mich Modal');
        contentArea.innerHTML = aboutContent.innerHTML;
        setupAboutMePagination(contentArea); 
        openModal(legalModal);
    }
}

// ===================================================================
// COOKIE MODAL SETUP
// ===================================================================
function setupCookieModal() {
    const cookieInfoLightbox = document.getElementById('cookie-info-lightbox');
    const acknowledgeCookieLightboxBtn = document.getElementById('acknowledge-cookie-lightbox');
    const privacyPolicyLinkButton = document.getElementById('privacy-policy-link-button');
    const cookieInfoButton = document.getElementById('cookie-info-button');

    if (cookieInfoLightbox && !localStorage.getItem('hasSeenCookieInfoLightbox')) {
        setTimeout(() => openModal(cookieInfoLightbox), 2000);
    }

    if (acknowledgeCookieLightboxBtn) {
        acknowledgeCookieLightboxBtn.addEventListener('click', () => {
            localStorage.setItem('hasSeenCookieInfoLightbox', 'true');
            closeModal(cookieInfoLightbox);
        });
    }

    if (privacyPolicyLinkButton) {
        privacyPolicyLinkButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (cookieInfoLightbox) closeModal(cookieInfoLightbox);
            loadLegalContentWithPagination('datenschutz.html');
        });
    }

    if (cookieInfoButton) {
        cookieInfoButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (cookieInfoLightbox) openModal(cookieInfoLightbox);
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
                contactSuccessMessage.style.display = 'none';
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
            const formData = new FormData(contactForm);
            const submitButton = contactForm.querySelector('button[type="submit"]');
            
            submitButton.disabled = true;
            submitButton.textContent = 'Wird gesendet...';

            try {
                const response = await fetch('/api/contact', {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();

                if (result.success) {
                    contactForm.style.display = 'none';
                    contactSuccessMessage.style.display = 'block';
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
// ABOUT ME MODAL SETUP
// ===================================================================
function setupAboutModal() {
    // Button im Header
    const aboutButton = document.getElementById('about-me-button');
    if (aboutButton) {
        aboutButton.addEventListener('click', (e) => {
            e.preventDefault();
            openAboutMeModal();
        });
    }

    // Button in der Sitemap
    const sitemapAboutButton = document.getElementById('sitemap-about-button');
    if (sitemapAboutButton) {
        sitemapAboutButton.addEventListener('click', (e) => {
            e.preventDefault();
            const searchModal = document.getElementById('search-modal');
            if (searchModal) closeModal(searchModal);
            openAboutMeModal();
        });
    }
}

// ===================================================================
// SEARCH MODAL SETUP (Inkl. Evita)
// ===================================================================

const siteContentIndex = [
    { 
        title: "Chat mit Evita (KI)", 
        url: "#open-evita",  // Spezial-URL für Evita
        keywords: "evita ai ki chat assistent frage hilfe künstliche intelligenz",
        desc: "Starte den Chat mit meiner KI-Assistentin Evita."
    },
    { 
        title: "Erfahre mehr über den Mann hinter den Pixeln (und Evita)", 
        url: "#open-about",
        keywords: "über mich wer bin ich profil michael kanda lebenslauf",
        desc: "Michael mag Tierschutz, Sport, sauberen Code und guten Cafe.."
    },
    { 
        title: "Michael Kanda - Komplize für Web & KI aus Wien", 
        url: "index.html", 
        keywords: "home startseite michael kanda webentwickler wien",
        desc: "Willkommen im privaten Code-Labor von Michael & Evita. Webentwicklung, KI-Experimente und digitale Abenteuer."
    },
    { 
        title: "KI-Integration auf Webseiten", 
        url: "KI-Integration-auf-Webseiten.html", 
        keywords: "ki integration künstliche intelligenz chatbot automatisierung",
        desc: "Wie KI moderne Webseiten interaktiver und effizienter macht."
    },
    { 
        title: "KI für Unternehmenswebseiten", 
        url: "ki-fuer-unternehmenswebseiten.html", 
        keywords: "unternehmen business b2b lösungen",
        desc: "Maßgeschneiderte KI-Lösungen für dein Unternehmen."
    },
    { 
        title: "SEO & GEO", 
        url: "geo-seo.html", 
        keywords: "seo suchmaschinenoptimierung google ranking geo lokal",
        desc: "Optimiere deine Seite für lokale Suchanfragen, Google und KI-Bots."
    },
    { 
        title: "Silas AI Creator", 
        url: "silas.html", 
        keywords: "silas ai creator tool generator content",
        desc: "Der KI-gestützte Content Creator für schnelle Ergebnisse."
    },
    { 
        title: "CSV Importer PRO", 
        url: "CSV-Importer-PRO.html", 
        keywords: "csv import tool daten management pro",
        desc: "Professionelles WordPress Tool zum Importieren großer Datensätze."
    },
];

function setupSearchModal() {
    const searchModal = document.getElementById('search-modal');
    const searchButton = document.getElementById('search-button');
    const closeSearchBtn = document.getElementById('close-search-modal');
    const searchInput = document.getElementById('site-search-input');
    const resultsContainer = document.getElementById('search-results-container');
    const resultsList = document.getElementById('search-results-list');
    const sitemapContainer = document.getElementById('sitemap-container');
    
    // Neuer Evita Sitemap Button
    const sitemapEvitaButton = document.getElementById('sitemap-evita-button');

    // Öffnen
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (searchModal) {
                openModal(searchModal);
                setTimeout(() => searchInput.focus(), 100);
            }
        });
    }

    // Schließen
    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            if (searchModal) closeModal(searchModal);
        });
    }

    // Evita Sitemap Button Handler
    if (sitemapEvitaButton) {
        sitemapEvitaButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (searchModal) closeModal(searchModal); // Suche schließen
            
            // Simuliere Klick auf den Header-Button, um Evita zu starten
            const evitaHeaderBtn = document.getElementById('evita-chat-button');
            if (evitaHeaderBtn) evitaHeaderBtn.click();
        });
    }

    // Suchlogik
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();

            if (query.length === 0) {
                sitemapContainer.style.display = 'block';
                resultsContainer.style.display = 'none';
            } else {
                sitemapContainer.style.display = 'none';
                resultsContainer.style.display = 'block';

                const results = siteContentIndex.filter(page => 
                    page.title.toLowerCase().includes(query) || 
                    page.keywords.includes(query) ||
                    page.desc.toLowerCase().includes(query)
                );
                renderSearchResults(results, resultsList);
            }
        });
    }
}

function renderSearchResults(results, listElement) {
    listElement.innerHTML = ''; 

    if (results.length === 0) {
        listElement.innerHTML = '<li style="color: #888; text-align: center; padding: 20px;">Keine Ergebnisse gefunden.</li>';
        return;
    }

    results.forEach(page => {
        const li = document.createElement('li');
        li.innerHTML = `
            <a href="${page.url}" class="search-result-link">
                <span class="search-result-title">${page.title}</span>
                <span class="search-result-snippet">${page.desc}</span>
            </a>
        `;
        
        li.querySelector('a').addEventListener('click', (e) => {
             const searchModal = document.getElementById('search-modal');
             
             if (page.url === '#open-about') {
                 // Über mich
                 e.preventDefault();
                 if (searchModal) closeModal(searchModal);
                 openAboutMeModal();
                 
             } else if (page.url === '#open-evita') {
                 // Evita Chat
                 e.preventDefault();
                 if (searchModal) closeModal(searchModal);
                 const evitaHeaderBtn = document.getElementById('evita-chat-button');
                 if (evitaHeaderBtn) evitaHeaderBtn.click();
                 
             } else {
                 // Normale Links
                 if (searchModal) closeModal(searchModal);
             }
        });
        
        listElement.appendChild(li);
    });
}

// ===================================================================
// ABOUT-ME PAGINATION
// ===================================================================
function setupAboutMePagination(contentArea) {
    const config = {
        totalPages: 2,
        pages: [
            { title: "Seite 1: Der Mann hinter den Pixeln", sections: [0, 0] },
            { title: "Seite 2: Mehr als Code und Pixel", sections: [1, 2] }
        ]
    };
    
    const paginationState = {
        currentPage: 0,
        pages: config.pages
    };
    
    function createPaginationHTML(pageIndex) {
        const isFirstPage = pageIndex === 0;
        const isLastPage = pageIndex === config.totalPages - 1;
        
        return `
            <div class="legal-modal-pagination-buttons">
                <button id="about-prev-btn" ${isFirstPage ? 'disabled' : ''}>
                    ← ${isFirstPage ? 'Erste Seite' : 'Vorherige Seite'}
                </button>
                <span style="color: var(--text-color); font-weight: 500; padding: 10px; text-align: center; font-size: 0.9rem;">
                    ${paginationState.pages[pageIndex].title}<br>
                    <small style="opacity: 0.7;">(${pageIndex + 1}/${config.totalPages})</small>
                </span>
                <button id="about-next-btn" ${isLastPage ? 'disabled' : ''}>
                    ${isLastPage ? 'Letzte Seite' : 'Nächste Seite'} →
                </button>
            </div>
        `;
    }
    
    function updatePagination() {
        const existingPagination = contentArea.querySelector('.legal-modal-pagination-buttons');
        if (existingPagination) existingPagination.remove();
        
        contentArea.insertAdjacentHTML('beforeend', createPaginationHTML(paginationState.currentPage));
        
        const prevBtn = document.getElementById('about-prev-btn');
        const nextBtn = document.getElementById('about-next-btn');
        
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
        const legalContainer = contentArea.querySelector('.legal-container');
        if (!legalContainer) return;
        
        const allElements = Array.from(legalContainer.children);
        allElements.forEach(element => element.style.display = 'none');
        
        const title = legalContainer.querySelector('h1');
        if (title) title.style.display = 'block';
        
        if (pageIndex === 0) {
            let foundBreakpoint = false;
            for (let i = 0; i < allElements.length; i++) {
                const element = allElements[i];
                const isBreakpoint = (element.tagName === 'H2' && 
                    (element.classList.contains('about-section-header') || 
                     element.textContent.includes('Doch Michael ist mehr als nur Code und Pixel')));
                
                if (isBreakpoint) {
                    foundBreakpoint = true;
                    break;
                }
                element.style.display = 'block';
            }
            if (!foundBreakpoint) {
                const splitIndex = Math.floor(allElements.length * 0.6);
                for (let i = 0; i < splitIndex; i++) {
                    if (allElements[i]) allElements[i].style.display = 'block';
                }
            }
        } else if (pageIndex === 1) {
            let foundBreakpoint = false;
            let breakpointIndex = -1;
            for (let i = 0; i < allElements.length; i++) {
                const element = allElements[i];
                const isBreakpoint = (element.tagName === 'H2' && 
                    (element.classList.contains('about-section-header') || 
                     element.textContent.includes('Doch Michael ist mehr als nur Code und Pixel')));
                
                if (isBreakpoint) {
                    foundBreakpoint = true;
                    breakpointIndex = i;
                    break;
                }
            }
            if (foundBreakpoint) {
                for (let i = breakpointIndex; i < allElements.length; i++) {
                    allElements[i].style.display = 'block';
                }
            } else {
                const splitIndex = Math.floor(allElements.length * 0.6);
                for (let i = splitIndex; i < allElements.length; i++) {
                    if (allElements[i]) allElements[i].style.display = 'block';
                }
            }
        }
        updatePagination();
        contentArea.scrollTop = 0;
    }
    showPage(0);
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
            const mainContent = doc.querySelector('main .legal-container') || 
                               doc.querySelector('.legal-container') || 
                               doc.querySelector('main') ||
                               doc.querySelector('body');

            if (mainContent) {
                contentArea.style.opacity = '0';
                contentArea.innerHTML = mainContent.innerHTML;
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
                { title: "Seite 1: Grundlagen & Rechte", sections: [0, 1] },
                { title: "Seite 2: Datenverarbeitung", sections: [2, 3] }, 
                { title: "Seite 3: Cookies & KI", sections: [4, 6] }
            ]
        },
        'impressum.html': {
            totalPages: 2,
            pages: [
                { title: "Seite 1: Kontakt & Grundlagen", sections: [0, 2] },
                { title: "Seite 2: Haftungsausschluss", sections: [3, 5] }
            ]
        },
        'disclaimer.html': {
            totalPages: 2,
            pages: [
                { title: "Seite 1: Abgrenzung & Urheberrecht", sections: [0, 1] },
                { title: "Seite 2: Haftungsausschluss", sections: [2, 3] }
            ]
        }
    };
    
    let config = pageConfigs[currentPage];
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
                <button id="legal-prev-btn" ${isFirstPage ? 'disabled' : ''}>← ${isFirstPage ? 'Erste' : 'Vorherige'}</button>
                <span style="color: var(--text-color); font-weight: 500; padding: 10px; text-align: center; font-size: 0.9rem;">
                    ${paginationState.pages[pageIndex].title}<br>
                    <small style="opacity: 0.7;">(${pageIndex + 1}/${config.totalPages})</small>
                </span>
                <button id="legal-next-btn" ${isLastPage ? 'disabled' : ''}>${isLastPage ? 'Letzte' : 'Nächste'} →</button>
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
            const openModal = document.querySelector('.modal-overlay.visible');
            if (openModal) closeModal(openModal);
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
    console.log('🚀 Initialisiere Modals (Optimiert)...');
    
    setTimeout(() => {
        setupCookieModal();
        setupContactModal();
        setupAboutModal();
        setupAiModal();
        setupSearchModal();
        setupLegalModalCloseButton();
        setupModalBackgroundClose();

        // HINWEIS: Die Event-Delegation für Impressum/Datenschutz wurde entfernt,
        // damit diese Links nun wie normale Links funktionieren (neuer Tab).

        console.log('✅ Modals bereit');
    }, 100);
}
