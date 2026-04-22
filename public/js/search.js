// ===================================================================
// SEARCH MODAL SETUP
// ===================================================================

// 1. Definiere deine Inhalte (Index)
const siteContentIndex = [
    { 
        title: "Michael Kanda & Evita - ganz privat.", 
        url: "index.html", 
        keywords: "home startseite michael kanda webentwickler wien",
        desc: "Willkommen im privaten Code-Labor von Michael & Evita. Webentwicklung, KI-Experimente und digitale Abenteuer."
    },
    { 
        title: "KI-Integration auf Webseiten", 
        url: "KI-Integration-auf-Webseiten.html", 
        keywords: "ki integration künstliche intelligenz chatbot automatisierung",
        desc: "Wie KI moderne Webseiten interaktiver und effizienter macht."
    },
    { 
        title: "KI für Unternehmenswebseiten", 
        url: "ki-fuer-unternehmenswebseiten.html", 
        keywords: "unternehmen business b2b lösungen",
        desc: "Maßgeschneiderte KI-Lösungen für dein Unternehmen."
    },
    { 
        title: "SEO & GEO", 
        url: "geo-seo.html", 
        keywords: "seo suchmaschinenoptimierung google ranking geo lokal",
        desc: "Optimiere deine Seite für lokale Suchanfragen,Google und KI-Bots."
    },
    { 
        title: "Silas AI Creator", 
        url: "silas.html", 
        keywords: "silas ai creator tool generator content",
        desc: "Der KI-gestützte Content Creator für schnelle Ergebnisse."
    },
    { 
        title: "CSV Importer PRO", 
        url: "CSV-Importer-PRO.html", 
        keywords: "csv import tool daten management pro",
        desc: "Professionelles Tool zum Importieren großer Datensätze."
    },
    
];

function setupSearchModal() {
    const searchModal = document.getElementById('search-modal');
    const searchButton = document.getElementById('search-button');
    const closeSearchBtn = document.getElementById('close-search-modal');
    const searchInput = document.getElementById('site-search-input');
    const resultsContainer = document.getElementById('search-results-container');
    const resultsList = document.getElementById('search-results-list');
    const sitemapContainer = document.getElementById('sitemap-container');

    // Öffnen
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.preventDefault();
            if (searchModal) {
                openModal(searchModal);
                // Fokus auf Input setzen
                setTimeout(() => searchInput.focus(), 100);
            }
        });
    }

    // Schließen
    if (closeSearchBtn) {
        closeSearchBtn.addEventListener('click', () => {
            if (searchModal) closeModal(searchModal);
        });
    }

    // Suchlogik
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();

            if (query.length === 0) {
                // Keine Eingabe -> Sitemap zeigen
                sitemapContainer.style.display = 'block';
                resultsContainer.style.display = 'none';
            } else {
                // Eingabe vorhanden -> Sitemap weg, Ergebnisse zeigen
                sitemapContainer.style.display = 'none';
                resultsContainer.style.display = 'block';

                // Filtern
                const results = siteContentIndex.filter(page => 
                    page.title.toLowerCase().includes(query) || 
                    page.keywords.includes(query) ||
                    page.desc.toLowerCase().includes(query)
                );

                // Rendern
                renderSearchResults(results, resultsList);
            }
        });
    }
}

function renderSearchResults(results, listElement) {
    listElement.innerHTML = ''; // Liste leeren

    if (results.length === 0) {
        listElement.innerHTML = '<li style="color: #888; text-align: center; padding: 20px;">Keine Ergebnisse gefunden.</li>';
        return;
    }

    results.forEach(page => {
        const li = document.createElement('li');
        li.innerHTML = `
            <a href="${page.url}" class="search-result-link">
                <span class="search-result-title">${page.title}</span>
                <span class="search-result-snippet">${page.desc}</span>
            </a>
        `;
        // Bei Klick Modal schließen
        li.querySelector('a').addEventListener('click', () => {
             const searchModal = document.getElementById('search-modal');
             closeModal(searchModal);
        });
        listElement.appendChild(li);
    });
}
