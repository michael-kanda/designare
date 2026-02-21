// js/main.js - KORRIGIERTE VERSION (CSS-gesteuerter Scroll-Lock)

if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

if (!window.location.hash) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
}

// === 1. IMPORTE ===
import { initTheme } from './theme.js';
import { initEffects } from './effects.js';
import { initTypewriters } from './typewriter.js';
import { initModals } from './modals.js';
import { initAiForm } from './ai-form.js';
import { initSilasForm } from './silas-form.js';
import { initMenuInteractions } from './menu-logic.js';
import { setupSearchModal } from './search.js';

let globalAiFormInstance = null;

const loadFeedback = async () => {
    const placeholder = document.getElementById('feedback-placeholder');
    if (!placeholder) return;
    try {
        const response = await fetch('blog-feedback.html');
        if (response.ok) placeholder.innerHTML = await response.text();
    } catch (e) {
        console.log("Info: Feedback-Sektion nicht geladen.");
    }
};

const initHeaderScrollEffect = () => {
    const header = document.querySelector('.main-header');
    if (!header) return;
    let lastScrollY = window.scrollY;

    const handleScroll = () => {
        const currentScrollY = window.scrollY;
        const footer = document.querySelector('footer'); 
        
        if (currentScrollY > 50) header.classList.add('scrolled');
        else { header.classList.remove('scrolled'); header.classList.remove('hide-up'); }

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
            e.preventDefault(); e.stopPropagation();
            sideMenu.classList.add('visible');
            document.body.classList.add('no-scroll'); // Temporärer Lock fürs Menü
        });

        const closeMenu = () => {
            sideMenu.classList.remove('visible');
            document.body.classList.remove('no-scroll'); // Lock aufheben. CSS kümmert sich um den Rest!
        };

        if (closeMenuButton) closeMenuButton.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); });
        document.addEventListener('click', (e) => { if (sideMenu.classList.contains('visible') && !sideMenu.contains(e.target) && !menuButton.contains(e.target)) closeMenu(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sideMenu.classList.contains('visible')) closeMenu(); });
    }
};

const setupEvitaChatButton = () => {
    const evitaChatButton = document.getElementById('evita-chat-button');
    if (evitaChatButton) evitaChatButton.addEventListener('click', async (e) => { e.preventDefault(); await launchEvitaChat(); });
};

window.launchEvitaChatFromAnywhere = async () => { await launchEvitaChat(); };

const launchEvitaChat = async () => {
    await ensureAiFormAvailable();
    await new Promise(resolve => setTimeout(resolve, 100));
    const aiResponseModal = document.getElementById('ai-response-modal');
    if (!aiResponseModal) return;
    
    aiResponseModal.style.display = 'flex';
    aiResponseModal.classList.add('visible');
    document.body.classList.add('no-scroll'); // Temporärer Lock fürs Modal
    
    setTimeout(() => {
        const chatHistory = document.getElementById('ai-chat-history');
        if (chatHistory && chatHistory.children.length === 0) {
            addWelcomeMessage("Hallo! Ich bin Evita, Michaels KI-Assistentin. Wie kann ich dir heute helfen?");
        }
        setTimeout(() => { const chatInput = document.getElementById('ai-chat-input'); if (chatInput) chatInput.focus(); }, 100);
    }, 300);
};

const ensureAiFormAvailable = async () => {
    if (globalAiFormInstance || document.getElementById('ai-chat-form')) return;
    try { await initAiForm(); globalAiFormInstance = true; } catch (error) { console.warn("Konnte AI-Form nicht vorladen:", error); }
};

const addWelcomeMessage = (message) => {
    const chatHistory = document.getElementById('ai-chat-history');
    if (!chatHistory) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message ai';
    messageDiv.textContent = message;
    chatHistory.appendChild(messageDiv);
};

// === 6. HERO FLIP LOGIK ===
const initHeroFlip = () => {
    const heroFlipWrapper = document.getElementById('hero-flip-wrapper');
    if (!heroFlipWrapper) return; // Wenn nicht vorhanden, sind wir nicht auf der Startseite

    // Wir SIND auf der Startseite! Klasse für CSS setzen:
    document.body.classList.add('is-home-page');

    const btnToBack = document.getElementById('flip-info-btn');
    const btnBackToStart = document.getElementById('flip-back-btn');
    const btnToThird = document.getElementById('flip-to-third-btn');
    const btnThirdToBack = document.getElementById('flip-third-back-btn');
    const btnThirdToStart = document.getElementById('flip-third-to-start-btn');
    
    const viewMain = document.getElementById('view-main');
    const viewThird = document.getElementById('view-third');

    const checkHashAndFlip = () => {
        const hash = window.location.hash;
        
        if (hash === '#michael') {
            if(viewMain) viewMain.style.display = 'flex';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.add('flipped');
            setTimeout(() => {
                const target = document.getElementById('michael');
                if (target) {
                    const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - (document.querySelector('.main-header')?.offsetHeight || 80) - 40;
                    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                }
            }, 300);
        } 
        else if (hash === '#evita') {
            if (viewMain) viewMain.style.display = 'none';
            if (viewThird) viewThird.style.display = 'flex';
            heroFlipWrapper.classList.remove('flipped');
            setTimeout(() => {
                const target = document.getElementById('evita');
                if (target) {
                    const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - (document.querySelector('.main-header')?.offsetHeight || 80) - 40;
                    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                }
            }, 300);
        }
        else {
            if(viewMain) viewMain.style.display = 'flex';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.remove('flipped');
            window.scrollTo(0, 0);
        }
    };

    checkHashAndFlip();
    window.addEventListener('hashchange', checkHashAndFlip);

    if (btnToBack) btnToBack.addEventListener('click', (e) => { e.preventDefault(); heroFlipWrapper.classList.add('flipped'); });
    if (btnBackToStart) btnBackToStart.addEventListener('click', (e) => { e.preventDefault(); history.pushState("", document.title, window.location.pathname + window.location.search); if(viewMain) viewMain.style.display = 'flex'; if(viewThird) viewThird.style.display = 'none'; heroFlipWrapper.classList.remove('flipped'); window.scrollTo({ top: 0, behavior: 'instant' }); });
    if (btnToThird) btnToThird.addEventListener('click', (e) => { e.preventDefault(); if (viewMain) viewMain.style.display = 'none'; if (viewThird) viewThird.style.display = 'flex'; heroFlipWrapper.classList.remove('flipped'); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => { const target = document.getElementById('evita'); if (target) { const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - (document.querySelector('.main-header')?.offsetHeight || 80) - 40; window.scrollTo({ top: offsetPosition, behavior: 'smooth' }); } }, 850); });
    if (btnThirdToBack) btnThirdToBack.addEventListener('click', (e) => { e.preventDefault(); if(viewMain) viewMain.style.display = 'flex'; if(viewThird) viewThird.style.display = 'none'; heroFlipWrapper.classList.add('flipped'); window.location.hash = '#michael'; setTimeout(() => { const target = document.getElementById('michael'); if (target) { const offsetPosition = target.getBoundingClientRect().top + window.pageYOffset - (document.querySelector('.main-header')?.offsetHeight || 80) - 40; window.scrollTo({ top: offsetPosition, behavior: 'smooth' }); } }, 300); });
    if (btnThirdToStart) btnThirdToStart.addEventListener('click', async (e) => { e.preventDefault(); if (btnThirdToStart.dataset.action === 'open-evita-chat') { await launchEvitaChat(); } else { if(viewMain) viewMain.style.display = 'flex'; if(viewThird) viewThird.style.display = 'none'; heroFlipWrapper.classList.remove('flipped'); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
};

// === 7. INITIALISIERUNG ===
const initializeDynamicScripts = () => {
    initModals(); initHeaderScrollEffect(); setupSideMenu(); setupEvitaChatButton(); initHeroFlip(); initTheme(); initMenuInteractions();
    if (typeof setupSearchModal === 'function') setupSearchModal();
};

const initializeStaticScripts = () => { initEffects(); initTypewriters(); };

const initializeForms = async () => {
    try { await initAiForm(); globalAiFormInstance = true; } catch (e) { console.warn(e); }
    try { initSilasForm(); } catch (e) { console.warn(e); }
};

document.addEventListener('DOMContentLoaded', async () => {
    if (!window.location.hash) { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
    if (localStorage.getItem('theme') === 'dark' || !localStorage.getItem('theme')) document.body.classList.add('dark-mode');

    initializeStaticScripts();
    await loadFeedback();

    requestAnimationFrame(() => {
        setTimeout(() => {
            initializeDynamicScripts();
            initializeForms();
            // Wir entfernen hier GANZ BEWUSST KEIN .no-scroll ! 
            // Modals haben es eh nicht am Start, und die Startseite sperrt sich übers CSS selbst!
            requestAnimationFrame(() => { document.body.classList.add('page-loaded'); });
        }, 50);
    });
});

setTimeout(() => {
    if (!document.body.classList.contains('page-loaded')) document.body.classList.add('page-loaded');
}, 5000);

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.performance-tip').forEach(el => observer.observe(el));
