/* ============================================================
   HOMEPAGE-SCROLL.JS
   Steuert das Scroll-Verhalten auf der Startseite
   MIT FIX: Scroll erlaubt + Footer versteckt wenn ai-question fokussiert (Mobile)
   ============================================================ */

(function() {
    'use strict';
    const DEBUG = false;
    const log = (...args) => { if (DEBUG) console.log(...args); };
    
    // DOM Elemente
    const flipContainer = document.querySelector('.flip-container');
    const body = document.body;
    const hero = document.getElementById('hero');
    const viewThird = document.getElementById('view-third');
    
    // State für Input-Focus
    let isAiInputFocused = false;
    let lastScrollMode = null; // 'enabled' | 'disabled'
    let lastFooterVisible = null;
    
    // Nur auf der Startseite mit Flip-Container ausführen
    if (!flipContainer || !hero) {
        log('[Scroll] Keine Flip-Container gefunden, Script beendet');
        return;
    }
    
    /**
     * Prüft ob es sich um ein mobiles Gerät handelt
     */
    function isMobile() {
        return window.innerWidth <= 768 || 
               ('ontouchstart' in window) || 
               (navigator.maxTouchPoints > 0);
    }
    
    /**
     * Prüft ob view-third (Evita) sichtbar ist
     */
    function isViewThirdVisible() {
        if (!viewThird) return false;
        
        const style = window.getComputedStyle(viewThird);
        const inlineDisplay = viewThird.style.display;
        
        return inlineDisplay === 'flex' || 
               inlineDisplay === 'block' || 
               style.display === 'flex' || 
               style.display === 'block';
    }
    
    /**
     * Prüft ob Flip Card geflippt ist
     */
    function isFlipped() {
        return flipContainer.classList.contains('flipped');
    }
    
    /**
     * Footer verstecken/zeigen
     */
    function setFooterVisibility(visible) {
        const footer = document.querySelector('footer');
        if (!footer) return;
        if (lastFooterVisible === visible) return;
        
        if (visible) {
            footer.classList.remove('ai-input-hide');
            log('[Scroll] Footer SICHTBAR');
        } else {
            footer.classList.add('ai-input-hide');
            log('[Scroll] Footer VERSTECKT');
        }
        lastFooterVisible = visible;
    }
    
    /**
     * Setzt den Scroll-Status basierend auf dem Flip-Zustand und Evita
     */
    function updateScrollState() {
        const flipped = isFlipped();
        const evitaVisible = isViewThirdVisible();
        
        log('[Scroll] Update:', { flipped, evitaVisible, isAiInputFocused, isMobile: isMobile() });
        
        // ✅ Wenn ai-question fokussiert ist UND mobile → Scrollen erlauben + Footer verstecken
        if (isAiInputFocused && isMobile()) {
            body.classList.remove('homepage-no-scroll');
            body.classList.add('homepage-scroll-enabled');
            body.classList.add('ai-input-focused');
            setFooterVisibility(false); // Footer verstecken
            if (lastScrollMode !== 'enabled') log('[Scroll] → Scroll ENABLED (AI Input fokussiert auf Mobile)');
            lastScrollMode = 'enabled';
            return;
        }
        
        // Entferne ai-input-focused Klasse wenn nicht mehr fokussiert
        body.classList.remove('ai-input-focused');
        setFooterVisibility(true); // Footer wieder zeigen
        
        if (flipped || evitaVisible) {
            body.classList.remove('homepage-no-scroll');
            body.classList.add('homepage-scroll-enabled');
            if (lastScrollMode !== 'enabled') log('[Scroll] → Scroll ENABLED');
            lastScrollMode = 'enabled';
        } else {
            body.classList.add('homepage-no-scroll');
            body.classList.remove('homepage-scroll-enabled');
            window.scrollTo(0, 0);
            if (lastScrollMode !== 'disabled') log('[Scroll] → Scroll DISABLED');
            lastScrollMode = 'disabled';
        }
    }
    
    /**
     * Setup Event Listener für ai-question Input
     */
    function setupAiInputListeners() {
        const aiQuestion = document.getElementById('ai-question');
        
        if (!aiQuestion) {
            setTimeout(setupAiInputListeners, 500);
            return;
        }
        
        log('[Scroll] AI-Question Input gefunden, setze Focus-Listener');
        
        // Focus Event
        aiQuestion.addEventListener('focus', () => {
            log('[Scroll] ai-question FOKUSSIERT');
            isAiInputFocused = true;
            
            if (isMobile()) {
                // Scroll aktivieren + Footer verstecken
                body.classList.remove('homepage-no-scroll');
                body.classList.add('homepage-scroll-enabled');
                body.classList.add('ai-input-focused');
                setFooterVisibility(false);
                
                // Input in View scrollen
                setTimeout(() => {
                    aiQuestion.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }, 300);
                
                setTimeout(() => {
                    aiQuestion.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }, 500);
            }
        });
        
        // Blur Event
        aiQuestion.addEventListener('blur', () => {
            log('[Scroll] ai-question BLUR');
            isAiInputFocused = false;
            
            setTimeout(() => {
                if (!isAiInputFocused) {
                    updateScrollState();
                }
            }, 200);
        });
        
        // Touch Events für bessere Mobile-Unterstützung
        aiQuestion.addEventListener('touchstart', () => {
            if (isMobile()) {
                isAiInputFocused = true;
                body.classList.remove('homepage-no-scroll');
                body.classList.add('homepage-scroll-enabled');
                setFooterVisibility(false);
            }
        }, { passive: true });
    }
    
    /**
     * Visual Viewport API für Keyboard-Erkennung
     */
    function setupVisualViewportListener() {
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                if (isAiInputFocused && isMobile()) {
                    const aiQuestion = document.getElementById('ai-question');
                    if (aiQuestion && document.activeElement === aiQuestion) {
                        setTimeout(() => {
                            aiQuestion.scrollIntoView({ 
                                behavior: 'smooth', 
                                block: 'center' 
                            });
                        }, 100);
                    }
                }
            });
        }
    }
    
    // Initial setzen
    setTimeout(updateScrollState, 100);
    
    // AI Input Listener initialisieren
    setupAiInputListeners();
    
    // Visual Viewport Listener
    setupVisualViewportListener();
    
    // MutationObserver für Flip Container
    const flipObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.attributeName === 'class') {
                log('[Scroll] Flip class changed');
                updateScrollState();
            }
        });
    });
    
    flipObserver.observe(flipContainer, {
        attributes: true,
        attributeFilter: ['class']
    });
    
    // MutationObserver für view-third (Evita)
    if (viewThird) {
        const viewThirdObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
                    log('[Scroll] Evita style/class changed');
                    setTimeout(updateScrollState, 50);
                }
            });
        });
        
        viewThirdObserver.observe(viewThird, {
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }
    
    // Event Listeners für Custom Events
    document.addEventListener('flipcard:flipped', updateScrollState);
    document.addEventListener('flipcard:unflipped', updateScrollState);
    document.addEventListener('evita:shown', updateScrollState);
    document.addEventListener('evita:hidden', updateScrollState);
    
    // Click-Events der Buttons
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-view], #show-evita-btn, #hide-evita-btn, .flip-btn-style');
        if (target) {
            setTimeout(updateScrollState, 100);
            setTimeout(updateScrollState, 300);
        }
    });
    
    // Export für manuelles Triggern
    window.updateHomepageScroll = updateScrollState;
    window.setAiInputFocused = function(focused) {
        isAiInputFocused = focused;
        updateScrollState();
    };
    
    log('[Scroll] Homepage-Scroll.js initialisiert (mit AI-Input + Footer Fix)');
    
})();
