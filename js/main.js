// js/main.js - KORRIGIERTE VERSION (Build-Time Injection)

// ✅ SOFORT ausführen - Browser Scroll-Restore deaktivieren
if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

// ✅ SOFORT nach oben scrollen (vor allem anderen!)
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

// === 2. GLOBALE STATES ===
let globalAiFormInstance = null;

// === 3. FEEDBACK LOADING (optional) ===
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
            
            // FIX: Prüfen ob wir auf der Landingpage "vorne" sind. Wenn ja, bleibt Scrollen gesperrt!
            const heroFlipped = document.getElementById('hero-flip-wrapper');
            const isFlipped = heroFlipped && heroFlipped.classList.contains('flipped');
            const hasHash = window.location.hash !== '';
            
            if (isFlipped || hasHash) {
                document.body.classList.remove('no-scroll');
            } else {
                document.body.classList.add('no-scroll');
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
    console.log("🚀 launchEvitaChat aufgerufen");
    
    await ensureAiFormAvailable();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const aiResponseModal = document.getElementById('ai-response-modal');
    
    if (!aiResponseModal) {
        console.error("❌ AI Response Modal nicht gefunden!");
        return;
    }
    
    aiResponseModal.style.display = 'flex';
    aiResponseModal.classList.add('visible');
    document.body.classList.add('no-scroll');
    
    setTimeout(() => {
        const chatHistory = document.getElementById('ai-chat-history');
        if (chatHistory && chatHistory.children.length === 0) {
            addWelcomeMessage("Hallo! Ich bin Evita, Michaels KI-Assistentin. Wie kann ich dir heute helfen?");
            console.log("✅ Begrüßung von launchEvitaChat hinzugefügt");
        }
        
        setTimeout(() => {
            const chatInput = document.getElementById('ai-chat-input');
            if (chatInput) chatInput.focus();
        }, 100);
    }, 300);
};

const ensureAiFormAvailable = async () => {
    if (globalAiFormInstance || document.getElementById('ai-chat-form')) {
        return;
    }
    
    try {
        await initAiForm();
        globalAiFormInstance = true;
    } catch (error) {
        console.warn("Konnte AI-Form nicht vorladen:", error);
    }
};

const addWelcomeMessage = (message) => {
    const chatHistory = document.getElementById('ai-chat-history');
    if (!chatHistory) {
        console.warn("⚠️ Chat-History Container nicht gefunden");
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message ai';
    messageDiv.textContent = message;
    chatHistory.appendChild(messageDiv);
    
    console.log("✅ Begrüßungsnachricht hinzugefügt");
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

    const checkHashAndFlip = () => {
        const hash = window.location.hash;
        
        if (hash === '#michael') {
            if(viewMain) viewMain.style.display = 'flex';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.add('flipped');
            
            document.body.classList.remove('no-scroll');
            
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
            
            document.body.classList.remove('no-scroll');
            
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
        else {
            // Startseite (kein Hash) - MUSS gesperrt sein!
            if(viewMain) viewMain.style.display = 'flex';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.remove('flipped');
            document.body.classList.add('no-scroll'); // HIER SPERREN!
            
            window.scrollTo(0, 0);
            setTimeout(() => window.scrollTo(0, 0), 100);
        }
    };

    checkHashAndFlip();
    window.addEventListener('hashchange', checkHashAndFlip);

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
            history.pushState("", document.title, window.location.pathname + window.location.search);
            
            if(viewMain) viewMain.style.display = 'flex';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.remove('flipped');
            document.body.classList.add('no-scroll'); // HIER SPERREN!
            
            setTimeout(() => {
                if(viewMain) {
                    viewMain.scrollIntoView({ behavior: 'instant', block: 'start' });
                }
            }, 50);
        });
    }
    
    if (btnToThird) {
        btnToThird.addEventListener('click', (e) => {
            e.preventDefault();
            if (viewMain) viewMain.style.display = 'none';
            if (viewThird) viewThird.style.display = 'flex';
            heroFlipWrapper.classList.remove('flipped');
            document.body.classList.remove('no-scroll');
            
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => {
                const target = document.getElementById('evita');
                if (target) {
                    const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
                    const elementPosition = target.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;
                    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                }
            }, 850);
        });
    }

    if (btnThirdToBack) {
        btnThirdToBack.addEventListener('click', (e) => {
            e.preventDefault();
            if(viewMain) viewMain.style.display = 'flex';
            if(viewThird) viewThird.style.display = 'none';
            heroFlipWrapper.classList.add('flipped');
            window.location.hash = '#michael';
            document.body.classList.remove('no-scroll');
            
            setTimeout(() => {
                const target = document.getElementById('michael');
                if (target) {
                    const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
                    const elementPosition = target.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;
                    window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                }
            }, 300);
        });
    }

    if (btnThirdToStart) {
        btnThirdToStart.addEventListener('click', async (e) => {
            e.preventDefault();
            if (btnThirdToStart.dataset.action === 'open-evita-chat') {
                await launchEvitaChat();
            } else {
                if(viewMain) viewMain.style.display = 'flex';
                if(viewThird) viewThird.style.display = 'none';
                heroFlipWrapper.classList.remove('flipped');
                document.body.classList.add('no-scroll'); // HIER SPERREN!
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }
};

// === 7. INITIALISIERUNG ===

const initializeDynamicScripts = () => {
    console.log("🔧 Initialisiere dynamische Scripte...");
    initModals();
    initHeaderScrollEffect(); 
    setupSideMenu();
    setupEvitaChatButton();
    initHeroFlip();
    initTheme(); 
    initMenuInteractions();
    
    // Check ob die Funktion existiert, bevor sie aufgerufen wird
    if (typeof setupSearchModal === 'function') {
        setupSearchModal();
    }
    console.log("✅ Dynamische Scripte initialisiert");
};

const initializeStaticScripts = () => {
    initEffects();
    initTypewriters();
};

const initializeForms = async () => {
    try { 
        await initAiForm(); 
        globalAiFormInstance = true;
    } catch (e) { 
        console.warn("AI-Form Init Fehler:", e); 
    }
    try { 
        initSilasForm(); 
    } catch (e) { 
        console.warn("Silas-Form Init Fehler:", e); 
    }
};

// === UNLOCK SCROLL FALLBACK (Muss ignoriert werden, wenn auf Home) ===
const unlockScrollFallback = () => {
    if (document.body.classList.contains('no-scroll')) {
        const modal = document.querySelector('.modal-overlay.visible');
        const sideMenu = document.getElementById('side-menu-panel');
        const sideMenuVisible = sideMenu?.classList.contains('visible');
        
        // FIX: Auch prüfen, ob wir auf der Landingpage ganz am Anfang sind
        const heroFlipped = document.getElementById('hero-flip-wrapper');
        const isFlipped = heroFlipped && heroFlipped.classList.contains('flipped');
        const isEvitaView = window.location.hash === '#evita';
        
        // Nur entsperren, wenn KEIN Modal, KEIN Menü offen ist UND wir NICHT mehr auf der Front-Page sind
        if (!modal && !sideMenuVisible && (isFlipped || isEvitaView)) {
            document.body.classList.remove('no-scroll');
            console.log("🔓 no-scroll Klasse entfernt (Fallback)");
        }
    }
};

// MAIN EVENT LISTENER
document.addEventListener('DOMContentLoaded', async () => {
    console.log("🚀 DOMContentLoaded - Starte Initialisierung...");
    
    if (!window.location.hash) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }
    
    if (localStorage.getItem('theme') === 'dark' || !localStorage.getItem('theme')) {
        document.body.classList.add('dark-mode');
    }

    initializeStaticScripts();
    await loadFeedback();

    requestAnimationFrame(() => {
        setTimeout(() => {
            initializeDynamicScripts();
            initializeForms();
            
            // FIX: Hier haben wir vorher pauschal "no-scroll" entfernt! Das darf nicht sein.
            // Die Logik dafür übernimmt jetzt "checkHashAndFlip" in der initHeroFlip() Funktion.
            
            requestAnimationFrame(() => {
                document.body.classList.add('page-loaded');
            });
            
            console.log("✅ Seite vollständig initialisiert");
        }, 50);
    });
    
    setTimeout(unlockScrollFallback, 2000);
});

setTimeout(() => {
    if (!document.body.classList.contains('page-loaded')) {
        console.warn("⚠️ Fallback: Seite nach 5s nicht geladen, erzwinge Anzeige");
        // FIX: Auch hier nicht pauschal entsperren, wenn auf Landingpage!
        document.body.classList.add('page-loaded');
    }
}, 5000);

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.performance-tip').forEach(el => observer.observe(el));
