// js/effects.js

/**
 * Aktualisiert die Farben der Partikel basierend auf den aktuellen CSS-Variablen.
 * Wird beim Theme-Wechsel von der theme.js aufgerufen.
 */
export function updateParticleColors() {
    // Hole die aktuellen Werte der CSS-Variablen vom Root-Element
    const rootStyles = getComputedStyle(document.documentElement);
    const particleColor = rootStyles.getPropertyValue('--particle-color').trim() || '#bbbbbb';
    const lineColor = rootStyles.getPropertyValue('--particle-line-color').trim() || '#555555';

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
    // Initialisiere particles.js
    // Die Farben werden hier zunächst gesetzt, aber durch updateParticleColors() verfeinert
    if (typeof particlesJS !== 'undefined') {
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
                    "value": "#bbbbbb" // Fallback-Farbe
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
                    "color": "#555555", // Fallback-Farbe
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

        // Nach der Initialisierung sofort die korrekten Farben aus dem CSS laden
        updateParticleColors();
    }
}
