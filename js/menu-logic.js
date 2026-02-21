// js/menu-logic.js

/**
 * Initialisiert alle Menü-Interaktionen:
 * 1. Suchfilter für die Themen-Buttons
 * 2. Dynamische Generierung des Inhaltsverzeichnisses (TOC)
 */
export function initMenuInteractions() {
    const searchInput = document.getElementById('menu-topic-search');
    const buttons = document.querySelectorAll('.topic-btn');

    // 1. Suchlogik für vorhandene Themen-Buttons im Menü
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            buttons.forEach(btn => {
                const keywords = btn.getAttribute('data-keywords')?.toLowerCase() || "";
                const text = btn.innerText.toLowerCase();

                // Highlight-Klasse hinzufügen, wenn der Suchbegriff (min. 2 Zeichen) passt
                if (term.length > 1 && (keywords.includes(term) || text.includes(term))) {
                    btn.classList.add('highlight-active');
                } else {
                    btn.classList.remove('highlight-active');
                }
            });
        });
    }

    // 2. TOC AUSKOMMENTIERT
    // generateDynamicTOC();
}

/* === TOC AUSKOMMENTIERT ===
/**
 * Erstellt dynamisch Buttons für alle H2-Überschriften der aktuellen Seite
 * und fügt sie in das Seitenmenü ein.
 */
/*
function generateDynamicTOC() {
    const tocContainer = document.getElementById('dynamic-toc-container');
    const tocList = document.getElementById('toc-list');
    
    // Suche nach h2 Überschriften im Hauptbereich
    const articleHeadings = document.querySelectorAll('main h2, article h2');

    if (articleHeadings.length > 0 && tocContainer && tocList) {
        tocContainer.classList.remove('hidden');
        tocList.innerHTML = ''; // Container leeren

        // Sortierung: Michael zuerst, dann Evita, dann der Rest
        const headingsArray = Array.from(articleHeadings);
        const sortedHeadings = headingsArray.sort((a, b) => {
            const aId = a.id || '';
            const bId = b.id || '';
            
            if (aId === 'michael') return -1;
            if (bId === 'michael') return 1;
            if (aId === 'evita') return -1;
            if (bId === 'evita') return 1;
            
            return 0;
        });

        sortedHeadings.forEach((heading, index) => {
            const rawText = heading.textContent.toLowerCase().trim();
            
            // Filter: Bestimmte Überschriften ignorieren
            if (rawText.includes("feedback geben") || 
                rawText.includes("weiterlesen") || 
                rawText.includes("bereit") || 
                rawText.includes("?") || 
                rawText.includes("fazit") || 
                rawText === "") {
                return;
            }

            // Anker-ID vergeben, falls nicht vorhanden
            if (!heading.id) {
                heading.id = `section-${index}`;
            }

            const tocBtn = document.createElement('button');
            tocBtn.className = 'topic-btn toc-mini';
            
            // --- TEXT-VERARBEITUNG ---
            // 1. Sonderzeichen entfernen (inkl. Bindestrich-Korrektur)
            let buttonText = heading.innerText.replace(/[^\w\säöüÄÖÜß?-]/g, '').trim();

            // 2. Mobile Kürzung auf 3 Wörter (bei Bildschirmbreite <= 768px)
            if (window.innerWidth <= 768) {
                const words = buttonText.split(/\s+/);
                if (words.length > 5) {
                    buttonText = words.slice(0, 5).join(' ') + '...';
                }
            }
            
            tocBtn.innerText = buttonText;
            
            // --- KLICK-LOGIK ---
            tocBtn.onclick = () => {
                const headingId = heading.id;
                const heroFlipWrapper = document.getElementById('hero-flip-wrapper');
                const viewMain = document.getElementById('view-main');
                const viewThird = document.getElementById('view-third');
                
                // Menü schließen
                document.getElementById('side-menu-panel').classList.remove('visible');
                document.body.classList.remove('no-scroll');
                
                // Spezial-Logik für Michael/Evita (Flip-Animation)
                if (headingId === 'michael' && heroFlipWrapper) {
                    if (viewMain) viewMain.style.display = 'block';
                    if (viewThird) viewThird.style.display = 'none';
                    heroFlipWrapper.classList.add('flipped');
                    
                    setTimeout(() => {
                        scrollToHeading(headingId);
                    }, 300);
                    
                } else if (headingId === 'evita' && heroFlipWrapper) {
                    if (viewMain) viewMain.style.display = 'none';
                    if (viewThird) viewThird.style.display = 'flex';
                    heroFlipWrapper.classList.remove('flipped');
                    
                    setTimeout(() => {
                        scrollToHeading(headingId);
                    }, 300);
                    
                } else {
                    // Normales Scrollen für alle anderen Sektionen
                    document.getElementById(headingId).scrollIntoView({ behavior: 'smooth' });
                }
            };

            tocList.appendChild(tocBtn);
        });
    }
}
*/

/* === scrollToHeading AUSKOMMENTIERT ===
/**
 * Hilfsfunktion für das sanfte Scrollen mit Header-Offset
 */
/*
function scrollToHeading(headingId) {
    const target = document.getElementById(headingId);
    if (target) {
        const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    }
}
*/
// === ENDE TOC AUSKOMMENTIERT ===
