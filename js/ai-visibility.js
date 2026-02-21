// js/ai-visibility.js - Frontend für KI-Sichtbarkeits-Check (Dual-KI: Gemini + ChatGPT)
// Fixes: XSS-Escaping, AbortController, Doppel-Submit-Schutz, Backend-Counter-Sync,
//        Inline-Styles → CSS-Klassen, Link-Validierung, Timestamp-Fallback

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('visibility-form');
    const domainInput = document.getElementById('domain-input');
    const industryInput = document.getElementById('industry-input');
    const submitBtn = document.getElementById('submit-btn');
    const resultsContainer = document.getElementById('results-container');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Accessibility: Screenreader informieren wenn Ergebnisse geladen
    resultsContainer.setAttribute('aria-live', 'polite');

    // =================================================================
    // FIX 1: XSS-SCHUTZ — escapeHTML für ALLE dynamischen Werte
    // =================================================================
    function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    // FIX 6: Nur sichere Links erlauben (relativ oder https)
    function safeHref(url) {
        if (!url || typeof url !== 'string') return '#';
        const trimmed = url.trim();
        // Relative Pfade erlauben
        if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
        // Nur https erlauben
        if (trimmed.startsWith('https://')) return trimmed;
        return '#';
    }

    // Classname-sicher: nur erlaubte Werte durchlassen
    function safeClass(value, allowed) {
        return allowed.includes(value) ? value : allowed[0];
    }

    // =================================================================
    // RATE LIMITING - 3 Abfragen pro Tag
    // =================================================================
    const DAILY_LIMIT = 3;
    const STORAGE_KEY = 'ai_visibility_usage';

    function getUsageData() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) return { date: null, count: 0 };
            return JSON.parse(data);
        } catch (e) {
            return { date: null, count: 0 };
        }
    }

    function setUsageData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('localStorage nicht verfügbar');
        }
    }

    function getTodayString() {
        return new Date().toISOString().split('T')[0];
    }

    function getRemainingChecks() {
        const usage = getUsageData();
        const today = getTodayString();
        if (usage.date !== today) return DAILY_LIMIT;
        return Math.max(0, DAILY_LIMIT - usage.count);
    }

    function incrementUsage() {
        const today = getTodayString();
        const usage = getUsageData();
        if (usage.date !== today) {
            setUsageData({ date: today, count: 1 });
        } else {
            setUsageData({ date: today, count: usage.count + 1 });
        }
    }

    // FIX 4: Backend-Counter übernehmen wenn vorhanden
    function syncWithBackend(remainingFromServer) {
        if (typeof remainingFromServer !== 'number') return;
        const today = getTodayString();
        const used = DAILY_LIMIT - remainingFromServer;
        setUsageData({ date: today, count: Math.max(0, used) });
    }

    function canMakeRequest() {
        return getRemainingChecks() > 0;
    }

    function updateLimitDisplay() {
        const remaining = getRemainingChecks();
        let limitInfo = document.getElementById('limit-info');
        
        if (!limitInfo) {
            limitInfo = document.createElement('div');
            limitInfo.id = 'limit-info';
            limitInfo.className = 'limit-info';
            form.insertBefore(limitInfo, submitBtn);
        }
        
        if (remaining === 0) {
            limitInfo.innerHTML = `
                <i class="fa-solid fa-clock"></i>
                <span>Tageslimit erreicht (${DAILY_LIMIT}/${DAILY_LIMIT}). Morgen wieder verfügbar!</span>
            `;
            limitInfo.classList.add('limit-reached');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Limit erreicht';
        } else {
            limitInfo.innerHTML = `
                <i class="fa-solid fa-circle-info"></i>
                <span>Noch <strong>${remaining}</strong> von ${DAILY_LIMIT} Checks heute verfügbar</span>
            `;
            limitInfo.classList.remove('limit-reached');
            submitBtn.disabled = false;
        }
    }

    updateLimitDisplay();

    // Quick-Select Buttons für Branchen
    document.querySelectorAll('.industry-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            industryInput.value = this.dataset.industry;
            document.querySelectorAll('.industry-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // =================================================================
    // FIX 2 & 3: AbortController + Doppel-Submit-Schutz
    // =================================================================
    let currentController = null;
    const REQUEST_TIMEOUT_MS = 60000; // 60 Sekunden

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (!canMakeRequest()) {
            showError('Du hast dein Tageslimit von 3 Checks erreicht. Probier es morgen wieder!');
            return;
        }
        
        const domain = domainInput.value.trim();
        if (!domain) {
            showError('Bitte gib eine Domain ein.');
            return;
        }

        // FIX 3: Vorherigen Request abbrechen falls noch laufend
        if (currentController) {
            currentController.abort();
        }
        currentController = new AbortController();
        const signal = currentController.signal;

        // FIX 2: Timeout
        const timeoutId = setTimeout(() => {
            currentController.abort();
        }, REQUEST_TIMEOUT_MS);

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analysiere...';
        loadingOverlay.classList.add('visible');
        resultsContainer.innerHTML = '';

        try {
            const response = await fetch('/api/ai-visibility-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: domain,
                    industry: industryInput.value.trim() || null
                }),
                signal
            });

            clearTimeout(timeoutId);
            const data = await response.json();

            if (response.status === 429) {
                throw new Error(data.message || 'Tageslimit erreicht. Bitte morgen wieder versuchen.');
            }

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Analyse fehlgeschlagen');
            }

            incrementUsage();

            // FIX 4: Backend-Counter synchronisieren
            if (data.meta && typeof data.meta.remainingChecks === 'number') {
                syncWithBackend(data.meta.remainingChecks);
            }

            updateLimitDisplay();
            renderResults(data);

        } catch (error) {
            if (error.name === 'AbortError') {
                showError('Analyse abgebrochen – Zeitlimit überschritten. Bitte erneut versuchen.');
            } else {
                console.error('Fehler:', error);
                showError(error.message || 'Ein Fehler ist aufgetreten.');
            }
        } finally {
            clearTimeout(timeoutId);
            currentController = null;
            submitBtn.disabled = getRemainingChecks() === 0;
            submitBtn.innerHTML = getRemainingChecks() === 0 
                ? '<i class="fa-solid fa-lock"></i> Limit erreicht'
                : '<i class="fa-solid fa-robot"></i> KI-Sichtbarkeit prüfen';
            loadingOverlay.classList.remove('visible');
        }
    });

    // =================================================================
    // XSS-SICHER: showError mit textContent statt innerHTML
    // =================================================================
    function showError(message) {
        const errorBox = document.createElement('div');
        errorBox.className = 'error-box';
        errorBox.setAttribute('role', 'alert');

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-triangle-exclamation';

        const p = document.createElement('p');
        p.textContent = message;

        errorBox.appendChild(icon);
        errorBox.appendChild(p);

        resultsContainer.innerHTML = '';
        resultsContainer.appendChild(errorBox);
    }

    // =================================================================
    // FIX 5: Status-Pill & Sentiment-Dot → CSS-Klassen statt Inline
    // =================================================================
    function statusPill(test) {
        if (!test) return '<span class="status-pill status-none">–</span>';
        if (test.mentioned) {
            return `<span class="status-pill status-mentioned">
                <i class="fa-solid fa-check"></i> Erwähnt
            </span>`;
        }
        return `<span class="status-pill status-not-mentioned">
            <i class="fa-solid fa-xmark"></i> Nicht erwähnt
        </span>`;
    }

    function sentimentDot(test) {
        if (!test) return '';
        const safeSentiment = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehler']);
        return `<span class="sentiment-indicator sentiment-${safeSentiment}">
            <span class="sentiment-dot"></span>
            ${esc(safeSentiment)}
        </span>`;
    }

    // =================================================================
    // FIX 7: Timestamp sicher formatieren
    // =================================================================
    function formatTimestamp(ts) {
        if (!ts) return 'Unbekannt';
        const date = new Date(ts);
        if (isNaN(date.getTime())) return 'Unbekannt';
        return date.toLocaleString('de-AT');
    }

    // =================================================================
    // RENDER RESULTS (alle dynamischen Werte escaped)
    //
    // Hinweis: test.response wird im Backend durch escapeHTML() sanitized
    // und enthält erlaubte Tags (<strong>, <p>, <br>, <ul>, <li>).
    // Alle ANDEREN Felder werden hier im Frontend via esc() escaped.
    // =================================================================
    function renderResults(data) {
        const { score, domainAnalysis, aiTests, competitors, recommendations } = data;

        // Tests nach Engine trennen
        const geminiTests = aiTests.filter(t => !t.engine || t.engine === 'gemini');
        const chatgptTests = aiTests.filter(t => t.engine === 'chatgpt');
        const hasChatGPT = chatgptTests.length > 0;

        // Score Ring
        const scoreColor = esc(score.color);
        const circumference = 2 * Math.PI * 54;
        const scoreTotal = Math.max(0, Math.min(100, parseInt(score.total) || 0));
        const offset = circumference - (scoreTotal / 100) * circumference;

        let html = `
            <!-- Score Overview -->
            <div class="result-section score-section">
                <div class="score-ring-container">
                    <svg class="score-ring" viewBox="0 0 120 120">
                        <circle class="score-ring-bg" cx="60" cy="60" r="54" />
                        <circle class="score-ring-progress" cx="60" cy="60" r="54" 
                            style="stroke: ${scoreColor}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset};" />
                    </svg>
                    <div class="score-value">
                        <span class="score-number">${scoreTotal}</span>
                        <span class="score-max">/100</span>
                    </div>
                </div>
                <div class="score-details">
                    <h3 style="color: ${scoreColor}">${esc(score.label)}</h3>
                    <p class="score-domain">${esc(data.domain)}</p>
                    ${data.industry ? `<p class="score-industry"><i class="fa-solid fa-tag"></i> ${esc(data.industry)}</p>` : ''}
                    ${hasChatGPT ? '<p class="score-engines"><i class="fa-solid fa-robot"></i> Geprüft mit Gemini + ChatGPT</p>' : ''}
                </div>
            </div>

            <!-- Score Breakdown -->
            <div class="result-section">
                <h3><i class="fa-solid fa-chart-pie"></i> Score-Zusammensetzung</h3>
                <div class="breakdown-grid">
                    ${score.breakdown.map(item => {
                        const points = parseInt(item.points) || 0;
                        const maxPoints = parseInt(item.maxPoints) || 1;
                        const fillWidth = Math.min(100, (points / maxPoints) * 100);
                        
                        return `
                            <div class="breakdown-item">
                                <div class="breakdown-header">
                                    <span class="breakdown-label">${esc(item.category)}</span>
                                    <span class="breakdown-points">${points}/${maxPoints}</span>
                                </div>
                                <div class="breakdown-bar">
                                    <div class="breakdown-fill" style="width: ${fillWidth}%"></div>
                                </div>
                                <p class="breakdown-detail">${esc(item.detail)}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        // =================================================================
        // KI-VERGLEICH (wenn ChatGPT vorhanden)
        // FIX 5: Inline-Styles → CSS-Klassen
        // =================================================================
        if (hasChatGPT) {
            const geminiKnowledge = geminiTests.find(t => t.id === 'knowledge');
            const chatgptKnowledge = chatgptTests.find(t => t.id === 'chatgpt_knowledge');
            const geminiReputation = geminiTests.find(t => t.id === 'reviews');
            const geminiExternal = geminiTests.find(t => t.id === 'mentions');

            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-code-compare"></i> KI-Vergleich: Gemini vs. ChatGPT</h3>
                    <p class="section-intro">Kennen die großen KI-Systeme deine Domain?</p>
                    
                    <div class="comparison-table-wrapper">
                        <table class="comparison-table">
                            <thead>
                                <tr>
                                    <th class="comparison-th-left">Test</th>
                                    <th class="comparison-th"><span class="engine-logo"><span class="engine-logo-badge engine-gemini">G</span> Gemini</span></th>
                                    <th class="comparison-th"><span class="engine-logo"><span class="engine-logo-badge engine-chatgpt">C</span> ChatGPT</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="comparison-td-left">
                                        <i class="fa-solid fa-magnifying-glass comparison-icon"></i>
                                        Bekanntheit
                                    </td>
                                    <td class="comparison-td">
                                        ${statusPill(geminiKnowledge)}
                                        <br>${sentimentDot(geminiKnowledge)}
                                    </td>
                                    <td class="comparison-td">
                                        ${statusPill(chatgptKnowledge)}
                                        <br>${sentimentDot(chatgptKnowledge)}
                                    </td>
                                </tr>
                                <tr>
                                    <td class="comparison-td-left">
                                        <i class="fa-solid fa-star comparison-icon"></i>
                                        Reputation
                                    </td>
                                    <td class="comparison-td">
                                        ${statusPill(geminiReputation)}
                                        <br>${sentimentDot(geminiReputation)}
                                    </td>
                                    <td class="comparison-td">
                                        <span class="comparison-na">nur Gemini</span>
                                    </td>
                                </tr>
                                <tr>
                                    <td class="comparison-td-left">
                                        <i class="fa-solid fa-link comparison-icon"></i>
                                        Ext. Erwähnungen
                                    </td>
                                    <td class="comparison-td">
                                        ${statusPill(geminiExternal)}
                                        <br>${sentimentDot(geminiExternal)}
                                    </td>
                                    <td class="comparison-td">
                                        <span class="comparison-na">nur Gemini</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        // =================================================================
        // DOMAIN ANALYSE
        // =================================================================
        html += `
            <div class="result-section">
                <h3><i class="fa-solid fa-magnifying-glass-chart"></i> Domain-Analyse</h3>
                
                <div class="analysis-grid">
                    <div class="analysis-card">
                        <h4>Schema.org</h4>
                        <div class="analysis-status ${domainAnalysis.schema.found ? 'status-good' : 'status-bad'}">
                            <i class="fa-solid ${domainAnalysis.schema.found ? 'fa-check' : 'fa-xmark'}"></i>
                            ${domainAnalysis.schema.found ? 'Vorhanden' : 'Nicht gefunden'}
                        </div>
                        ${domainAnalysis.schema.types.length > 0 ? `
                            <div class="schema-types">
                                ${domainAnalysis.schema.types.map(t => `<span class="schema-tag">${esc(t)}</span>`).join('')}
                            </div>
                        ` : ''}
                    </div>

                    <div class="analysis-card">
                        <h4>E-E-A-T Signale</h4>
                        <ul class="eeat-list">
                            <li class="${domainAnalysis.eeat.aboutPage ? 'check' : 'missing'}">
                                <i class="fa-solid ${domainAnalysis.eeat.aboutPage ? 'fa-check' : 'fa-xmark'}"></i>
                                Über-uns Seite
                            </li>
                            <li class="${domainAnalysis.eeat.contactPage ? 'check' : 'missing'}">
                                <i class="fa-solid ${domainAnalysis.eeat.contactPage ? 'fa-check' : 'fa-xmark'}"></i>
                                Kontakt/Impressum
                            </li>
                            <li class="${domainAnalysis.eeat.authorInfo ? 'check' : 'missing'}">
                                <i class="fa-solid ${domainAnalysis.eeat.authorInfo ? 'fa-check' : 'fa-xmark'}"></i>
                                Autoren-Informationen
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        `;

        // =================================================================
        // GEMINI TESTS
        // =================================================================
        html += `
            <div class="result-section">
                <h3><span class="engine-badge engine-gemini">Gemini</span> Live-Tests mit Google-Suche</h3>
                <p class="section-intro">Gemini durchsucht das Web live (Grounding) und prüft deine Sichtbarkeit:</p>
                
                <div class="tests-accordion">
                    ${geminiTests.map((test, index) => {
                        const safeSentiment = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehler']);
                        return `
                        <details class="test-item ${test.mentioned ? 'mentioned' : 'not-mentioned'}" ${index === 0 ? 'open' : ''}>
                            <summary>
                                <span class="test-status">
                                    <i class="fa-solid ${test.mentioned ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                                </span>
                                <span class="test-name">${esc(test.description)}</span>
                                <span class="test-sentiment sentiment-${safeSentiment}">${esc(safeSentiment)}</span>
                                <span class="test-toggle"><i class="fa-solid fa-chevron-down"></i></span>
                            </summary>
                            <div class="test-content">
                                <div class="test-response">${test.response}</div>
                                ${test.competitors.length > 0 ? `
                                    <div class="test-competitors">
                                        <strong>Erwähnte Alternativen:</strong>
                                        ${test.competitors.map(c => `<span class="competitor-tag">${esc(c)}</span>`).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        </details>
                    `}).join('')}
                </div>
            </div>
        `;

        // =================================================================
        // CHATGPT TESTS (wenn vorhanden)
        // FIX 5: Inline-Styles → CSS-Klassen
        // =================================================================
        if (hasChatGPT) {
            const chatgptKnown = chatgptTests.find(t => t.id === 'chatgpt_knowledge')?.mentioned;
            
            const chatgptInsightClass = chatgptKnown ? 'chatgpt-insight-positive' : 'chatgpt-insight-negative';
            const chatgptInsightIcon = chatgptKnown ? '✅' : '⚠';
            const chatgptInsightTitle = chatgptKnown 
                ? 'In ChatGPTs Wissensbasis' 
                : 'Nicht in ChatGPTs Wissensbasis';
            const chatgptInsightText = chatgptKnown 
                ? 'ChatGPT kennt dein Unternehmen. Du bist auch für ChatGPT-Nutzer sichtbar.'
                : 'ChatGPT kennt deine Domain nicht. Nutzer von ChatGPT sehen bei Branchenanfragen nur deine Konkurrenten. Mehr externe Erwähnungen und strukturierte Daten können helfen.';

            html += `
                <div class="result-section">
                    <h3><span class="engine-badge engine-chatgpt">ChatGPT</span> Wissens-Check</h3>
                    <p class="section-intro">ChatGPT antwortet aus seinem Trainings&shy;wissen – ohne Live-Suche:</p>
                    
                    <div class="${chatgptInsightClass}">
                        <strong>${chatgptInsightIcon} ${chatgptInsightTitle}</strong><br>
                        ${chatgptInsightText}
                    </div>
                    
                    <div class="tests-accordion">
                        ${chatgptTests.map((test, index) => {
                            const safeSentiment = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehler']);
                            return `
                            <details class="test-item ${test.mentioned ? 'mentioned' : 'not-mentioned'}" ${index === 0 ? 'open' : ''}>
                                <summary>
                                    <span class="test-status">
                                        <i class="fa-solid ${test.mentioned ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                                    </span>
                                    <span class="test-name">${esc(test.description)}</span>
                                    <span class="test-sentiment sentiment-${safeSentiment}">${esc(safeSentiment)}</span>
                                    <span class="test-toggle"><i class="fa-solid fa-chevron-down"></i></span>
                                </summary>
                                <div class="test-content">
                                    <div class="test-response">${test.response}</div>
                                    ${test.competitors.length > 0 ? `
                                        <div class="test-competitors">
                                            <strong>Erwähnte Alternativen:</strong>
                                            ${test.competitors.map(c => `<span class="competitor-tag">${esc(c)}</span>`).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            </details>
                        `}).join('')}
                    </div>
                </div>
            `;
        }

        // =================================================================
        // KONKURRENTEN (FIX 1: escaped, FIX 6: safeHref)
        // =================================================================
        if (competitors.length > 0) {
            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-users"></i> Konkurrenten in KI-Antworten</h3>
                    <p class="section-intro">Diese Domains werden statt deiner erwähnt:</p>
                    <div class="competitors-list">
                        ${competitors.map(c => `
                            <a href="${safeHref('https://' + c)}" target="_blank" rel="noopener noreferrer" class="competitor-link">
                                <i class="fa-solid fa-external-link"></i> ${esc(c)}
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // =================================================================
        // EMPFEHLUNGEN (FIX 1: escaped, FIX 6: safeHref)
        // =================================================================
        if (recommendations.length > 0) {
            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-lightbulb"></i> Empfehlungen</h3>
                    <div class="recommendations-list">
                        ${recommendations.map(rec => {
                            const safePriority = safeClass(rec.priority, ['hoch', 'mittel']);
                            return `
                            <div class="recommendation-card priority-${safePriority}">
                                <div class="rec-priority">${safePriority === 'hoch' ? 'Priorität: Hoch' : 'Priorität: Mittel'}</div>
                                <h4>${esc(rec.title)}</h4>
                                <p>${esc(rec.description)}</p>
                                ${rec.link ? `<a href="${safeHref(rec.link)}" class="rec-link">Mehr erfahren <i class="fa-solid fa-arrow-right"></i></a>` : ''}
                            </div>
                        `}).join('')}
                    </div>
                </div>
            `;
        }

        // =================================================================
        // FOOTER (FIX 7: sicherer Timestamp)
        // =================================================================
        html += `
            <div class="result-footer">
                <p><i class="fa-solid fa-clock"></i> Analyse vom ${formatTimestamp(data.timestamp)}</p>
                <p class="disclaimer">Hinweis: KI-Antworten variieren. Dieser Test ist eine Momentaufnahme.${hasChatGPT ? ' ChatGPT nutzt Trainingswissen, Gemini durchsucht das Web live.' : ''}</p>
            </div>
        `;

        resultsContainer.innerHTML = html;

        // Animate score ring
        setTimeout(() => {
            document.querySelector('.score-ring-progress')?.classList.add('animated');
        }, 100);

        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});
