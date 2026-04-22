// js/main.js

// === 1. IMPORTE ===
import { initTheme } from './theme.js';
import { initEffects } from './effects.js';
import { initTypewriters } from './typewriter.js';
import { initModals } from './modals.js';
import { initAiForm } from './ai-form.js';
import { initSilasForm } from './silas-form.js';
import { initMenuInteractions } from './menu-logic.js'; // NEU: Import der interaktiven Menü-Logik

// === 2. GLOBALE STATES ===
let globalAiFormInstance = null;

// === 3. CONTENT LOADING HELPER ===
const loadContent = async (url, elementId) => {
    const placeholder = document.getElementById(elementId);
    if (!placeholder) {
        return Promise.resolve(); 
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP Error ${response.status} bei ${url}`);
        const data = await response.text();
        placeholder.innerHTML = data;
    } catch (error) {
        console.warn(`⚠️ Konnte ${url} nicht in #${elementId} laden:`, error);
    }
};

const loadFeedback = async () => {
    const placeholder = document.getElementById('feedback-placeholder');
    if (!placeholder) return;
    
    try {
        const response = await fetch('blog-feedback.html');
        if (response.ok) {
            placeholder.innerHTML = await response.text();
        }
    } catch (e) {
        console.log("Info: Feedback-Sektion nicht geladen (optional).");
    }
};

// === 4. SMART HEADER & FOOTER LOGIK ===
const initHeaderScrollEffect = () => {
    const header = document.querySelector('.main-header');
    if (!header) return;

    let lastScrollY = window.scrollY;

    const handleScroll = () => {
        const currentScrollY = window.scrollY;
        const footer = document.querySelector('footer'); 
        
        if (currentScrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
            header.classList.remove('hide-up'); 
        }

        const isAtBottom = (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 50;

        if (currentScrollY > 100 && !isAtBottom) {
            if (currentScrollY > lastScrollY) {
                header.classList.add('hide-up');
                if (footer) footer.classList.add('hide-down');
            } else {
                header.classList.remove('hide-up');
                if (footer) footer.classList.remove('hide-down');
            }
        } else if (isAtBottom) {
            if (footer) footer.classList.remove('hide-down');
        } else {
            if (footer) footer.classList.remove('hide-down');
        }

        lastScrollY = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
};

const setupSideMenu = () => {
    const menuButton = document.getElementById('menu-toggle-button');
    const sideMenu = document.getElementById('side-menu-panel');
    const closeMenuButton = document.getElementById('close-menu-button');

    if (menuButton && sideMenu) {
        menuButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sideMenu.classList.add('visible');
            document.body.classList.add('no-scroll');
        });

        const closeMenu = () => {
            sideMenu.classList.remove('visible');
            const heroFlipped = document.querySelector('.hero-flip-wrapper.flipped'); 
            if (!heroFlipped) {
                document.body.classList.remove('no-scroll');
            }
        };

        if (closeMenuButton) {
            closeMenuButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
            });
        }

        document.addEventListener('click', (e) => {
            if (sideMenu.classList.contains('visible') && 
                !sideMenu.contains(e.target) && 
                !menuButton.contains(e.target)) {
                closeMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sideMenu.classList.contains('visible')) {
                closeMenu();
            }
        });
    }
};

// === 5. EVITA CHAT LOGIK ===
const setupEvitaChatButton = () => {
    const evitaChatButton = document.getElementById('evita-chat-button');
    if (evitaChatButton) {
        evitaChatButton.addEventListener('click', async (e) => {
            e.preventDefault();
            await launchEvitaChat();
        });
    }
};

window.launchEvitaChatFromAnywhere = async () => {
    await launchEvitaChat();
};

const launchEvitaChat = async () => {
    await ensureAiFormAvailable();
    
    const aiResponseModal = document.getElementById('ai-response-modal');
    if (aiResponseModal) {
        const chatHistory = document.getElementById('ai-chat-history');
        if (chatHistory && chatHistory.children.length === 0) {
             addWelcomeMessage("Hallo! Ich bin Evita, Michaels KI-Assistentin. Wie kann ich dir heute helfen?");
        }
        
        aiResponseModal.classList.add('visible');
        document.body.classList.add('no-scroll');
        
        setTimeout(() => {
            const chatInput = document.getElementById('ai-chat-input');
            if (chatInput) chatInput.focus();
        }, 300);
    }
};

const ensureAiFormAvailable = async () => {
    if (globalAiFormInstance || document.getElementById('ai-chat-form')) return;
    try {
        await initAiForm();
        globalAiFormInstance = true;
    } catch (error) {
        console.warn("Konnte AI-Form nicht vorladen:", error);
    }
};

const addWelcomeMessage = (message) => {
    const chatHistory = document.getElementById('ai-chat-history');
    if (!chatHistory) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message ai';
    messageDiv.innerHTML = `<div class="message-content">${message}</div>`;
    chatHistory.appendChild(messageDiv);
};

// === 6. HERO FLIP LOGIK ===
const initHeroFlip = () => {
    const heroFlipWrapper = document.getElementById('hero-flip-wrapper');
    if (!heroFlipWrapper) return;

    const btnToBack = document.getElementById('flip-info-btn');
    const btnBackToStart = document.getElementById('flip-back-btn');
    const btnToThird = document.getElementById('flip-to-third-btn');
    const btnThirdToBack = document.getElementById('flip-third-back-btn');
    const btnThirdToStart = document.getElementById('flip-third-to-start-btn');
    
    const viewMain = document.getElementById('view-main');
    const viewThird = document.getElementById('view-third');

    // --- FIX: Hash-Check Funktion mit Scroll-Freigabe ---
    const checkHashAndFlip = () => {
        const hash = window.location.hash;
        
        if (hash === '#michael') {
            if(viewMain) viewMain.style.display = 'block';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.add('flipped');
            
            // WICHTIG: Scrolling erlauben!
            document.body.classList.remove('no-scroll');
            
            // Timeout gibt der Flip-Animation Zeit, bevor gescrollt wird
            setTimeout(() => {
                const target = document.getElementById('michael');
                if (target) {
                    const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
                    const elementPosition = target.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });
                }
            }, 300);
        } 
        else if (hash === '#evita') {
            if (viewMain) viewMain.style.display = 'none';
            if (viewThird) viewThird.style.display = 'flex';
            heroFlipWrapper.classList.remove('flipped');
            
            // WICHTIG: Scrolling erlauben!
            document.body.classList.remove('no-scroll');
            
            // Auch hier zum Anker scrollen
            setTimeout(() => {
                const target = document.getElementById('evita');
                if (target) {
                    const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
                    const elementPosition = target.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });
                }
            }, 300);
        }
    };

    // Führe den Check sofort aus (beim Initialisieren)
    checkHashAndFlip();

    // Reagiere auf Änderungen des Hashes (wenn man im Menü klickt)
    window.addEventListener('hashchange', checkHashAndFlip);

    // --- BESTEHENDE EVENT LISTENER ---
    if (btnToBack) {
        btnToBack.addEventListener('click', (e) => {
            e.preventDefault();
            heroFlipWrapper.classList.add('flipped');
            document.body.classList.remove('no-scroll');
        });
    }

    if (btnBackToStart) {
        btnBackToStart.addEventListener('click', (e) => {
            e.preventDefault();
            // Entferne Hash beim Klick auf Home/Zurück
            history.pushState("", document.title, window.location.pathname + window.location.search);
            if(viewMain) viewMain.style.display = 'block';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.remove('flipped');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    if (btnToThird) {
        btnToThird.addEventListener('click', (e) => {
            e.preventDefault();
            if (viewMain) viewMain.style.display = 'none';
            if (viewThird) viewThird.style.display = 'flex';
            heroFlipWrapper.classList.remove('flipped');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (btnThirdToBack) {
        btnThirdToBack.addEventListener('click', (e) => {
            e.preventDefault();
            heroFlipWrapper.classList.add('flipped');
        });
    }

    if (btnThirdToStart) {
        btnThirdToStart.addEventListener('click', async (e) => {
            e.preventDefault();
            if (btnThirdToStart.dataset.action === 'open-evita-chat') {
                await launchEvitaChat();
            } else {
                if(viewMain) viewMain.style.display = 'block';
                if(viewThird) viewThird.style.display = 'none';
                heroFlipWrapper.classList.remove('flipped');
            }
        });
    }
};

// === 7. INITIALISIERUNG ===

const initializeDynamicScripts = () => {
    initModals();
    initHeaderScrollEffect(); 
    setupSideMenu();
    setupEvitaChatButton();
    initHeroFlip();
    initTheme(); 
    initMenuInteractions(); // NEU: Initialisierung der Themen-Suche im Menü
};

const initializeStaticScripts = () => {
    initEffects();
    initTypewriters();
};

const initializeForms = async () => {
    try { await initAiForm(); } catch (e) { console.warn(e); }
    try { initSilasForm(); } catch (e) { console.warn(e); }
};

// MAIN EVENT LISTENER
document.addEventListener('DOMContentLoaded', async () => {
    
    // Vorab-Check für den Theme-Status
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    initializeStaticScripts();

    try {
        // Sequentielles Laden, um sicherzustellen, dass DOM-Elemente vorhanden sind
        await loadContent('header.html', 'header-placeholder');
        await loadContent('modals.html', 'modal-container');
        await loadContent('footer.html', 'footer-placeholder');
        await loadContent('side-menu.html', 'side-menu-placeholder');
        await loadFeedback();

        console.log("✅ Layout geladen.");
        
        // Kleine Verzögerung, um sicherzugehen, dass die innerHTML-Inhalte verarbeitet wurden
        setTimeout(() => {
            initializeDynamicScripts();
            initializeForms();
        }, 100);

        document.body.classList.add('page-loaded');

    } catch (error) {
        console.error("❌ Fehler beim Laden der Komponenten:", error);
        document.body.classList.add('page-loaded');
    }
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.performance-tip').forEach(el => observer.observe(el));
