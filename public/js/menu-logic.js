// js/menu-logic.js

export function initMenuInteractions() {
    const searchInput = document.getElementById('menu-topic-search');
    const buttons = document.querySelectorAll('.topic-btn');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            buttons.forEach(btn => {
                const keywords = btn.getAttribute('data-keywords')?.toLowerCase() || "";
                const text = btn.innerText.toLowerCase();

                if (term.length > 1 && (keywords.includes(term) || text.includes(term))) {
                    btn.classList.add('highlight-active');
                } else {
                    btn.classList.remove('highlight-active');
                }
            });
        });
    }

    // Starte die Inhaltsverzeichnis-Logik
    generateDynamicTOC();
}

function generateDynamicTOC() {
    const tocContainer = document.getElementById('dynamic-toc-container');
    const tocList = document.getElementById('toc-list');
    
    // Wir suchen nach h2 Überschriften im Hauptbereich (main oder article)
    const articleHeadings = document.querySelectorAll('main h2, article h2');

    if (articleHeadings.length > 0 && tocContainer && tocList) {
        // Container sichtbar machen
        tocContainer.classList.remove('hidden');
        tocList.innerHTML = ''; // Vorher leeren

        // Sortiere Überschriften: Michael zuerst, dann Evita, dann der Rest
        const headingsArray = Array.from(articleHeadings);
        const sortedHeadings = headingsArray.sort((a, b) => {
            const aId = a.id || '';
            const bId = b.id || '';
            
            if (aId === 'michael') return -1;
            if (bId === 'michael') return 1;
            if (aId === 'evita') return -1;
            if (bId === 'evita') return 1;
            
            return 0; // Behalte die ursprüngliche Reihenfolge für den Rest
        });

        sortedHeadings.forEach((heading, index) => {
            // Sicherstellen, dass die Überschrift eine ID für den Anker-Link hat
            if (!heading.id) {
                heading.id = `section-${index}`;
            }

            // Mini-Button für das TOC erstellen
            const tocBtn = document.createElement('button');
            tocBtn.className = 'topic-btn toc-mini';
            
            // KORREKTUR: Bindestrich (-) wurde zur Regex hinzugefügt
            tocBtn.innerText = heading.innerText.replace(/[^\w\säöüÄÖÜß?-]/g, ''); 
            
            // Klick-Event: Zum Anker springen und Menü schließen
            tocBtn.onclick = () => {
                const headingId = heading.id;
                const heroFlipWrapper = document.getElementById('hero-flip-wrapper');
                const viewMain = document.getElementById('view-main');
                const viewThird = document.getElementById('view-third');
                
                // Menü schließen
                document.getElementById('side-menu-panel').classList.remove('visible');
                document.body.classList.remove('no-scroll');
                
                // Prüfe ob wir auf der Startseite sind und zu #michael oder #evita navigieren
                if (headingId === 'michael' && heroFlipWrapper) {
                    // Zeige Michael-Seite (zurück)
                    if (viewMain) viewMain.style.display = 'block';
                    if (viewThird) viewThird.style.display = 'none';
                    heroFlipWrapper.classList.add('flipped');
                    
                    // Scrolle nach Animation
                    setTimeout(() => {
                        const target = document.getElementById(headingId);
                        if (target) {
                            const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
                            const elementPosition = target.getBoundingClientRect().top;
                            const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;
                            window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                        }
                    }, 300);
                    
                } else if (headingId === 'evita' && heroFlipWrapper) {
                    // Zeige Evita-Seite
                    if (viewMain) viewMain.style.display = 'none';
                    if (viewThird) viewThird.style.display = 'flex';
                    heroFlipWrapper.classList.remove('flipped');
                    
                    // Scrolle nach Animation
                    setTimeout(() => {
                        const target = document.getElementById(headingId);
                        if (target) {
                            const headerOffset = document.querySelector('.main-header')?.offsetHeight || 80;
                            const elementPosition = target.getBoundingClientRect().top;
                            const offsetPosition = elementPosition + window.pageYOffset - headerOffset - 40;
                            window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
                        }
                    }, 300);
                    
                } else {
                    // Normale Scroll-Logik für andere Überschriften
                    document.getElementById(headingId).scrollIntoView({ behavior: 'smooth' });
                }
            };

            tocList.appendChild(tocBtn);
        });
    }
}
