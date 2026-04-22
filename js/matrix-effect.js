// Matrix-Effekt mit intelligenter Initialisierung

function initMatrixEffect() {
    console.log('Versuche Matrix-Effekt zu initialisieren...');
    
    const canvas = document.getElementById('matrix-canvas');
    const sideMenu = document.getElementById('side-menu-panel');
    
    // KORREKTUR: Maximal 10 Versuche, dann aufgeben
    if (!canvas || !sideMenu) {
        // Prüfe, ob wir schon zu oft versucht haben
        if (!window.matrixRetryCount) window.matrixRetryCount = 0;
        window.matrixRetryCount++;
        
        if (window.matrixRetryCount > 10) {
            console.log('Matrix-Effekt: Maximale Anzahl Versuche erreicht. Beende Initialisierung.');
            return;
        }
        
        console.log(`Canvas oder Menu noch nicht verfügbar, versuche erneut in 200ms... (Versuch ${window.matrixRetryCount}/10)`);
        setTimeout(initMatrixEffect, 200);
        return;
    }
    
    console.log('Canvas und Menu gefunden - initialisiere Matrix-Effekt');
    
    const ctx = canvas.getContext('2d');
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#FCB500';
    const alphabet = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッンABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const fontSize = 16;
    let intervalId = null;
    let rainDrops = [];

    const updateCanvasSize = () => {
        const rect = sideMenu.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        
        const columns = Math.ceil(canvas.width / fontSize);
        rainDrops = [];
        for (let x = 0; x < columns; x++) {
            rainDrops[x] = Math.floor(Math.random() * canvas.height / fontSize);
        }
    };

    const draw = () => {
        if (!canvas.width || !canvas.height) return;

        ctx.fillStyle = 'rgba(26, 26, 33, 0.08)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = accentColor;
        ctx.font = `${fontSize}px monospace`;

        for (let i = 0; i < rainDrops.length; i++) {
            const text = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
            const x = i * fontSize;
            const y = rainDrops[i] * fontSize;
            
            ctx.fillText(text, x, y);

            if (y > canvas.height && Math.random() > 0.975) {
                rainDrops[i] = 0;
            }
            rainDrops[i]++;
        }
    };

    const startAnimation = () => {
        if (intervalId) return;
        
        updateCanvasSize();
        
        if (canvas.width > 0 && canvas.height > 0) {
            intervalId = setInterval(draw, 50);
            console.log('Matrix-Animation gestartet');
        }
    };

    const stopAnimation = () => {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
            console.log('Matrix-Animation gestoppt');
        }
        
        if (canvas.width && canvas.height) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    // Event-Listener für Menu-Buttons
    const menuToggleButton = document.getElementById('menu-toggle-button');
    const closeMenuButton = document.getElementById('close-menu-button');

    if (menuToggleButton) {
        menuToggleButton.addEventListener('click', () => {
            console.log('Menu öffnen');
            sideMenu.classList.add('is-active');
            setTimeout(startAnimation, 200);
        });
    }

    if (closeMenuButton) {
        closeMenuButton.addEventListener('click', () => {
            console.log('Menu schließen');
            stopAnimation();
            sideMenu.classList.remove('is-active');
        });
    }

    // MutationObserver als Backup
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.attributeName === 'class') {
                const targetElement = mutation.target;
                if (targetElement.classList.contains('is-active')) {
                    setTimeout(startAnimation, 200);
                } else {
                    stopAnimation();
                }
            }
        }
    });

    observer.observe(sideMenu, { attributes: true });

    // Resize-Handler
    window.addEventListener('resize', () => {
        if (sideMenu.classList.contains('is-active') && intervalId) {
            stopAnimation();
            setTimeout(startAnimation, 100);
        }
    });

    window.addEventListener('beforeunload', stopAnimation);
    
    console.log('Matrix-Effekt erfolgreich initialisiert');
    
    // WICHTIG: Retry-Counter zurücksetzen, da Initialisierung erfolgreich war
    window.matrixRetryCount = 0;
}

// Starte die Initialisierung nur einmal
let matrixInitialized = false;

function safeInitMatrix() {
    if (matrixInitialized) return;
    matrixInitialized = true;
    
    console.log('DOM geladen, starte Matrix-Initialisierung...');
    initMatrixEffect();
}

// Event-Listener nur einmal registrieren
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInitMatrix);
} else {
    safeInitMatrix();
}
