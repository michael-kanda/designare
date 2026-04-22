// js/theme.js
import { updateParticleColors } from './effects.js';

function applyTheme(theme) {
    const body = document.body;
    if (theme === 'light') {
        body.classList.add('light-mode');
    } else {
        body.classList.remove('light-mode');
    }
    // Wichtig: Partikel-Farben anpassen
    if (typeof updateParticleColors === 'function') {
        updateParticleColors();
    }
}

function handleThemeToggle() {
    const isLight = document.body.classList.contains('light-mode');
    const newTheme = isLight ? 'dark' : 'light';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
    console.log("🌙 Theme gewechselt zu:", newTheme);
}

export function initTheme() {
    // WICHTIG: Den Button erst hier suchen, wenn der Header geladen ist!
    const themeToggle = document.getElementById('theme-toggle');
    
    if (themeToggle) {
        console.log("✅ Theme-Button im Header gefunden.");
        const savedTheme = localStorage.getItem('theme') || 'dark';
        applyTheme(savedTheme);
        
        // Event-Listener entfernen (falls vorhanden) und neu setzen, um Doppel-Events zu vermeiden
        themeToggle.removeEventListener('click', handleThemeToggle);
        themeToggle.addEventListener('click', handleThemeToggle);
    } else {
        console.warn("⚠️ Theme-Button (#theme-toggle) wurde im DOM nicht gefunden.");
    }
}
