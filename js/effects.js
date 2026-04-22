// js/effects.js

/**
 * Aktualisiert die Farben der Partikel basierend auf den aktuellen CSS-Variablen.
 * Wird beim Theme-Wechsel von der theme.js aufgerufen.
 */
export function updateParticleColors() {
    const isLightMode = document.body.classList.contains('light-mode') || 
                        document.documentElement.classList.contains('light-mode');
    
    // Partikel-Farben je nach Modus für besseren Kontrast
    let particleColor, lineColor;
    
    if (isLightMode) {
        // Light Mode: Minimal dunkler für leichten Kontrast auf weißem Hintergrund
    particleColor = '#555555';
        lineColor = '#666666';
    } else {
        // Dark Mode: Sehr minimal heller für leichten Kontrast auf dunklem Hintergrund
    particleColor = '#777777';
        lineColor = '#666666';
    }

    // Prüfen, ob particles.js geladen und initialisiert ist
    if (window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS) {
        const pJS = window.pJSDom[0].pJS;

        // Farben im Partikel-Objekt aktualisieren
        pJS.particles.color.value = particleColor;
        if (pJS.particles.line_linked) {
            pJS.particles.line_linked.color = lineColor;
        }

        // Canvas erneuern, um Änderungen sofort sichtbar zu machen
        pJS.fn.particlesRefresh();
    }
}

/**
 * Initialisiert den Partikel-Effekt mit Basiseinstellungen.
 */
export function initEffects() {
    // 1. Prüfen, ob die Bibliothek geladen ist
    if (typeof particlesJS !== 'undefined') {
        
        // 2. WICHTIG: Prüfen, ob der Container auf dieser Seite existiert!
        // Das verhindert den "TypeError: t is null"-Fehler auf Unterseiten.
        const particlesContainer = document.getElementById('particles-js');
        
        if (particlesContainer) {
            particlesJS("particles-js", {
                "particles": {
                    "number": {
                        "value": 80,
                        "density": {
                            "enable": true,
                            "value_area": 800
                        }
                    },
                    "color": {
                        "value": "#777777" // Dark Mode Default - sehr minimal sichtbar
                    },
                    "shape": {
                        "type": "circle",
                        "stroke": {
                            "width": 0,
                            "color": "#000000"
                        }
                    },
                    "opacity": {
                        "value": 0.4,
                        "random": false,
                        "anim": {
                            "enable": false
                        }
                    },
                    "size": {
                        "value": 3,
                        "random": true,
                        "anim": {
                            "enable": false
                        }
                    },
                    "line_linked": {
                        "enable": true,
                        "distance": 150,
                        "color": "#666666", // Dark Mode Default - sehr minimal sichtbar
                        "opacity": 0.5,
                        "width": 1
                    },
                    "move": {
                        "enable": true,
                        "speed": 2,
                        "direction": "none",
                        "random": false,
                        "straight": false,
                        "out_mode": "out",
                        "bounce": false,
                        "attract": {
                            "enable": false,
                            "rotateX": 600,
                            "rotateY": 1200
                        }
                    }
                },
                "interactivity": {
                    "detect_on": "canvas",
                    "events": {
                        "onhover": {
                            "enable": true,
                            "mode": "repulse"
                        },
                        "onclick": {
                            "enable": true,
                            "mode": "push"
                        },
                        "resize": true
                    },
                    "modes": {
                        "grab": {
                            "distance": 400,
                            "line_opacity": 1
                        },
                        "bubble": {
                            "distance": 400,
                            "size": 40,
                            "duration": 2,
                            "opacity": 8,
                            "speed": 3
                        },
                        "repulse": {
                            "distance": 200,
                            "duration": 0.4
                        },
                        "push": {
                            "particles_nb": 4
                        },
                        "remove": {
                            "particles_nb": 2
                        }
                    }
                },
                "retina_detect": true
            });

            // Nach der Initialisierung sofort die korrekten Farben aus dem Theme laden
            updateParticleColors();
        }
    }
}
