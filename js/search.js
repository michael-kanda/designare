// ===================================================================
// SEARCH MODAL SETUP (Powered by existing Knowledge Base)
// ===================================================================

let siteContentIndex = [];
let isIndexLoaded = false;

function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 1. Daten laden (Aus deiner existierenden knowledge.json)
function loadSearchIndex() {
    if (isIndexLoaded) return;

    fetch('/knowledge.json')
        .then(response => {
            if (!response.ok) throw new Error("knowledge.json nicht gefunden");
            return response.json();
        })
        .then(data => {
            // WICHTIG: Deine generate-knowledge.js speichert die Seiten unter "pages"
            // Wir prüfen, ob es data.pages gibt, sonst nehmen wir data direkt (Falls sich Struktur ändert)
            const pagesArray = data.pages ? data.pages : (Array.isArray(data) ? data : []);

            siteContentIndex = pagesArray.map(item => ({
                title: item.title,
                // Deine URL hat schon einen Slash (z.B. "/index.html"), das passt
                url: item.url, 
                // item.text ist der gesäuberte Volltext aus deinem Script
                content: item.text || "", 
                // Meta Description für die hübsche Anzeige
                desc: item.meta_description || item.text.substring(0, 100) + "..."
            }));

            isIndexLoaded = true;
            console.log(`🧠 Evita-Knowledge geladen: ${siteContentIndex.length} Seiten indexiert.`);
        })
        .catch(err => {
            console.error('Fehler beim Laden der Knowledge-Base:', err);
        });
}

// 2. Hauptfunktion
export function setupSearchModal() {
    loadSearchIndex(); // Index laden anstoßen

    const searchInput = document.getElementById('site-search-input');
    const resultsList = document.getElementById('search-results-list');
    const sitemapContainer = document.getElementById('sitemap-container');
    const resultsContainer = document.getElementById('search-results-container');
    
    // Buttons & Modal Logik
    const searchModal = document.getElementById('search-modal');
    const searchButtons = document.querySelectorAll('#search-button, .open-search-modal, .footer-btn.open-search-modal'); 
    const closeSearchBtn = document.getElementById('close-search-modal');

    // Helper: Modal öffnen/schließen
    const openModal = (modal) => {
        modal.classList.add('visible');
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
    };
    
    const closeModal = (modal) => {
        modal.classList.remove('visible');
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    };

    // Event Listener für Öffnen
    searchButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (searchModal) {
                openModal(searchModal);
                setTimeout(() => searchInput && searchInput.focus(), 100);
            }
        });
    });

    // Schließen
    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            if (searchModal) closeModal(searchModal);
        });
    }

    // VOLLTEXT-SUCHLOGIK
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();

            // Umschalten zwischen Sitemap und Ergebnissen
            if (query.length === 0) {
                if (sitemapContainer) sitemapContainer.style.display = 'block';
                if (resultsContainer) resultsContainer.style.display = 'none';
            } else {
                if (sitemapContainer) sitemapContainer.style.display = 'none';
                if (resultsContainer) resultsContainer.style.display = 'block';

                // Filtern: Sucht im Titel UND im gesamten Text (content)
                const results = siteContentIndex.filter(page => 
                    (page.title && page.title.toLowerCase().includes(query)) || 
                    (page.content && page.content.toLowerCase().includes(query))
                );

                renderSearchResults(results, resultsList, query, searchModal, closeModal);
            }
        });
    }
}

// Render Funktion mit Snippet-Highlighting
function renderSearchResults(results, listElement, query, modal, closeFunc) {
    if (!listElement) return;
    listElement.innerHTML = '';

    if (results.length === 0) {
        const li = document.createElement('li');
        li.style.padding = '20px';
        li.style.textAlign = 'center';
        li.style.color = 'var(--text-color-muted)';
        li.textContent = 'Keine Ergebnisse gefunden.';
        listElement.appendChild(li);
        return;
    }

    results.forEach(page => {
        const li = document.createElement('li');
        
        // Snippet generieren: Zeige den relevanten Textausschnitt
        let snippet = page.desc;
        if (page.content) {
            const index = page.content.toLowerCase().indexOf(query);
            if (index > -1) {
                // Text um den Treffer herum ausschneiden (30 Zeichen davor, 80 danach)
                const start = Math.max(0, index - 30);
                const end = Math.min(page.content.length, index + 80);
                snippet = "..." + page.content.substring(start, end) + "...";
            }
        }

        const link = document.createElement('a');
        link.href = typeof page.url === 'string' ? page.url : '#';
        link.className = 'search-result-link';

        const title = document.createElement('span');
        title.className = 'search-result-title';
        title.textContent = page.title || 'Ohne Titel';

        const snippetEl = document.createElement('span');
        snippetEl.className = 'search-result-snippet';

        const safeQuery = String(query || '').trim();
        if (!safeQuery) {
            snippetEl.textContent = snippet;
        } else {
            const regex = new RegExp(`(${escapeRegExp(safeQuery)})`, 'gi');
            const parts = String(snippet).split(regex);
            parts.forEach(part => {
                if (part.toLowerCase() === safeQuery.toLowerCase()) {
                    const highlight = document.createElement('span');
                    highlight.style.color = 'var(--accent-color)';
                    highlight.style.fontWeight = '600';
                    highlight.textContent = part;
                    snippetEl.appendChild(highlight);
                } else {
                    snippetEl.appendChild(document.createTextNode(part));
                }
            });
        }

        link.appendChild(title);
        link.appendChild(snippetEl);
        li.appendChild(link);
        
        // Klick schließt Modal
        link.addEventListener('click', () => {
             if (modal && closeFunc) closeFunc(modal);
        });
        
        listElement.appendChild(li);
    });
}
