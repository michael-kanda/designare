// js/theme.js - UPDATED: Material Symbol Icon Toggle + dynamischer Font-Load
import { updateParticleColors } from './effects.js';

// Material Symbols Font dynamisch laden (einmalig)
(function loadMaterialSymbols() {
    if (document.querySelector('link[href*="Material+Symbols+Outlined"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    // HIER GEÄNDERT: cookie und mail zu den icon_names hinzugefügt
    link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=dark_mode,sunny,cookie,mail';
    document.head.appendChild(link);
})();

function applyTheme(theme) {
    const html = document.documentElement;
    const body = document.body;
    const themeToggle = document.getElementById('theme-toggle');
    
    if (theme === 'light') {
        html.classList.add('light-mode');
        body.classList.add('light-mode');
    } else {
        html.classList.remove('light-mode');
        body.classList.remove('light-mode');
    }
    
    // aria-checked für Accessibility aktualisieren
    if (themeToggle) {
        themeToggle.setAttribute('aria-checked', (theme === 'light').toString());
        themeToggle.setAttribute('aria-label', 
            theme === 'light' ? 'Zum Dunkelmodus wechseln' : 'Zum Hellmodus wechseln'
        );
    }
    
    // Statustext aktualisieren
    const themeStatus = document.getElementById('theme-status');
    if (themeStatus) {
        themeStatus.textContent = theme === 'light' ? 'Aktuell: Hellmodus' : 'Aktuell: Dunkelmodus';
    }
    
    // Partikel-Farben anpassen
    if (typeof updateParticleColors === 'function') {
        setTimeout(() => {
            updateParticleColors();
        }, 50);
    }
}

function handleThemeToggle(e) {
    if (e) {
        e.preventDefault();
    }
    
    const isLight = document.documentElement.classList.contains('light-mode') || 
                    document.body.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
    
    // Custom Event für andere Komponenten
    window.dispatchEvent(new CustomEvent('themechange', { 
        detail: { theme: newTheme } 
    }));
    
    console.log("🌙 Theme gewechselt zu:", newTheme);
}

export function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    
    if (themeToggle) {
        console.log("✅ Theme-Toggle gefunden.");
        
        const htmlHasLightMode = document.documentElement.classList.contains('light-mode');
        const savedTheme = localStorage.getItem('theme') || 'dark';
        
        // Synchronisiere body mit html (falls Flash Prevention Script aktiv war)
        if (htmlHasLightMode && savedTheme === 'light') {
            document.body.classList.add('light-mode');
        }
        
        // Theme anwenden
        applyTheme(savedTheme);
        
        // Alte Event-Listener entfernen (falls vorhanden)
        themeToggle.removeEventListener('click', handleThemeToggle);
        
        // Click Event
        themeToggle.addEventListener('click', handleThemeToggle);
        
        // Keyboard Support (Space & Enter für Accessibility)
        themeToggle.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                handleThemeToggle();
            }
        });
        
    } else {
        console.warn("⚠️ Theme-Toggle (#theme-toggle) nicht gefunden.");
    }
}

// Optionaler Export für direkten Zugriff
export { handleThemeToggle, applyTheme };
