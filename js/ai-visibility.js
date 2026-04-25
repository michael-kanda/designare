// js/ai-visibility.js - Frontend für KI-Sichtbarkeits-Check (Dual-KI: Gemini + ChatGPT)
// Fixes: XSS-Escaping, AbortController, Doppel-Submit-Schutz, Backend-Counter-Sync,
//        Inline-Styles → CSS-Klassen, Link-Validierung, Timestamp-Fallback

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('visibility-form');
    const domainInput = document.getElementById('domain-input');
    const industryInput = document.getElementById('industry-input');
    const brandInput = document.getElementById('brand-input');
    const locationInput = document.getElementById('location-input');
    const submitBtn = document.getElementById('submit-btn');
    const resultsContainer = document.getElementById('results-container');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Loading-Status-Element dynamisch ergänzen (falls nicht im HTML)
    if (loadingOverlay && !loadingOverlay.querySelector('.loading-status')) {
        const container = loadingOverlay.querySelector('.loading-content') || loadingOverlay;
        const statusEl = document.createElement('div');
        statusEl.className = 'loading-status';
        container.appendChild(statusEl);
    }

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

    // Fix 4: HTML-Sanitization für KI-Antworten (erlaubt nur sichere Tags)
    const ALLOWED_TAGS = ['strong', 'em', 'p', 'br', 'ul', 'ol', 'li', 'b', 'i'];
    function sanitizeHTML(html) {
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: [] });
        }
        // Fallback: alle Tags entfernen
        return esc(html.replace(/<[^>]*>/g, ''));
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
        
        // Fix 18: Rate-Limit nur als UX-Hinweis, Backend ist autoritativ
        // Frontend-localStorage kann umgangen werden, daher kein harter Block hier
        
        const domain = domainInput.value.trim();
        const brand = brandInput?.value.trim() || '';
        if (!domain && !brand) {
            showError('Bitte gib eine Domain oder einen Firmennamen ein.');
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

        // Live-Status-Updates: Phasen passend zum Backend-Ablauf
        const progressSteps = domain
            ? [
                { text: 'Untersuche Website-Struktur …', delay: 0 },
                { text: 'Prüfe Schema.org & E-E-A-T Signale …', delay: 2500 },
                { text: 'Befrage Gemini zur Domain …', delay: 5000 },
                { text: 'Analysiere KI-Sichtbarkeit …', delay: 9000 },
                { text: 'ChatGPT Cross-Check läuft …', delay: 13000 },
                { text: 'Berechne Sichtbarkeits-Score …', delay: 17000 },
                { text: 'Fast fertig – Empfehlungen werden erstellt …', delay: 21000 }
            ]
            : [
                { text: 'Starte Namenssuche …', delay: 0 },
                { text: 'Befrage Gemini …', delay: 3000 },
                { text: 'Analysiere KI-Sichtbarkeit …', delay: 7000 },
                { text: 'ChatGPT Cross-Check läuft …', delay: 11000 },
                { text: 'Berechne Sichtbarkeits-Score …', delay: 15000 },
                { text: 'Fast fertig – Empfehlungen werden erstellt …', delay: 19000 }
            ];
        const statusEl = loadingOverlay.querySelector('.loading-status');
        const progressTimers = [];
        if (statusEl) {
            statusEl.textContent = progressSteps[0].text;
            statusEl.style.opacity = '1';
            for (let i = 1; i < progressSteps.length; i++) {
                progressTimers.push(setTimeout(() => {
                    statusEl.style.opacity = '0';
                    setTimeout(() => {
                        statusEl.textContent = progressSteps[i].text;
                        statusEl.style.opacity = '1';
                    }, 200);
                }, progressSteps[i].delay));
            }
        }

        try {
            const response = await fetch('/api/ai-visibility-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    domain: domain || null,
                    industry: industryInput.value.trim() || null,
                    brandName: brandInput?.value.trim() || null,
                    standort: locationInput?.value.trim() || null
                }),
                signal
            });

            clearTimeout(timeoutId);
            
            // Fix 11: Status prüfen bevor JSON geparst wird
            if (response.status === 429) {
                let msg = 'Tageslimit erreicht. Bitte morgen wieder versuchen.';
                try { const d = await response.json(); msg = d.message || msg; } catch (e) {}
                throw new Error(msg);
            }
            
            if (!response.ok) {
                let msg = 'Analyse fehlgeschlagen';
                try { const d = await response.json(); msg = d.message || msg; } catch (e) {}
                throw new Error(msg);
            }
            
            const data = await response.json();

            if (!data.success) {
                throw new Error(data.message || 'Analyse fehlgeschlagen');
            }

            // NEU: Bei Cache-Hit Timer abbrechen und UI updaten
            if (data.cached) {
                progressTimers.forEach(t => clearTimeout(t));
                if (statusEl) {
                    statusEl.textContent = 'Ergebnis aus dem Cache geladen! ⚡';
                    statusEl.style.opacity = '1';
                }
            }

            // Fix 9: Bei Cache-Hit keinen Check verbrauchen
            if (!data.cached) {
                incrementUsage();
            }

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
            progressTimers.forEach(t => clearTimeout(t));
            if (statusEl && (!currentController || currentController.signal.aborted)) { 
                statusEl.textContent = ''; 
                statusEl.style.opacity = '0'; 
            }
            currentController = null;
            submitBtn.disabled = getRemainingChecks() === 0;
            submitBtn.innerHTML = getRemainingChecks() === 0 
                ? '<i class="fa-solid fa-lock"></i> Limit erreicht'
                : '<i class="fa-solid fa-robot"></i> KI-Sichtbarkeit prüfen';
            
            // Kleine Verzögerung, damit man die Cache-Meldung kurz sieht
            setTimeout(() => {
                loadingOverlay.classList.remove('visible');
            }, 800);
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
        const safeSentiment = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehlend', 'fehler']);
        // "fehlend" bei erwähnten Tests nicht anzeigen (verwirrend)
        if ((safeSentiment === 'fehlend' || safeSentiment === 'fehler') && test.mentioned) {
            return '';
        }
        const labels = { positiv: 'positiv', neutral: 'neutral', negativ: 'negativ', fehlend: 'k.A.', fehler: 'Fehler' };
        return `<span class="sentiment-indicator sentiment-${safeSentiment}">
            <span class="sentiment-dot"></span>
            ${labels[safeSentiment] || safeSentiment}
        </span>`;
    }

    // =================================================================
    // Sentiment-basierte Icons für Accordion-Header
    // =================================================================
    function sentimentIcon(test) {
        if (!test) return { icon: 'fa-circle-minus', cls: 'neutral-mentioned' };
        const s = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehlend', 'fehler']);
        if (s === 'positiv') return { icon: 'fa-circle-check', cls: 'mentioned' };
        if (s === 'negativ') return { icon: 'fa-circle-xmark', cls: 'not-mentioned' };
        // neutral, fehlend, fehler → blue minus
        return { icon: 'fa-circle-minus', cls: 'neutral-mentioned' };
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
    // Zusätzlich wird hier im Frontend via sanitizeHTML()/DOMPurify gefiltert.
    // Alle ANDEREN Felder werden hier im Frontend via esc() escaped.
    // =================================================================
    function renderResults(data) {
        const { score, domainAnalysis, aiTests, competitors, recommendations, reportToken, crawlerAccess } = data;

        // Tests nach Engine trennen
        const geminiTests = aiTests.filter(t => !t.engine || t.engine === 'gemini');
        const chatgptTests = aiTests.filter(t => t.engine === 'chatgpt');
        const hasChatGPT = chatgptTests.length > 0;

        // Score Ring mit Range
        const scoreColor = esc(score.color);
        const circumference = 2 * Math.PI * 54;
        const scoreTotal = Math.max(0, Math.min(100, parseInt(score.total) || 0));
        const scoreMin = score.range ? Math.max(0, parseInt(score.range.min) || 0) : scoreTotal;
        const scoreMax = score.range ? Math.min(100, parseInt(score.range.max) || 0) : scoreTotal;
        const offset = circumference - (scoreTotal / 100) * circumference;

        let html = `
            <div class="result-section score-section">
                <div class="score-ring-container">
                    <svg class="score-ring" viewBox="0 0 120 120">
                        <circle class="score-ring-bg" cx="60" cy="60" r="54" />
                        <circle class="score-ring-progress" cx="60" cy="60" r="54" 
                            style="stroke: ${scoreColor}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset};" />
                    </svg>
                    <div class="score-value">
                        <span class="score-number">${scoreMin}–${scoreMax}</span>
                    </div>
                </div>
                <div class="score-details">
                    <h3 style="color: ${scoreColor}">${esc(score.label)}</h3>
                    <p class="score-domain">${esc(data.domain)}${!data.hasDomain ? ' <small>(Namenssuche)</small>' : ''}</p>
                    ${data.industry ? `<p class="score-industry"><i class="fa-solid fa-tag"></i> ${esc(data.industry)}</p>` : ''}
                    ${data.companyName ? `<p class="score-company"><i class="fa-solid fa-building"></i> ${esc(data.companyName)}</p>` : ''}
                    ${hasChatGPT ? '<p class="score-engines"><i class="fa-solid fa-robot"></i> Geprüft mit Gemini + ChatGPT</p>' : ''}
                </div>
            </div>
        `;

        // =================================================================
        // VERDICT: Klartext-Erklärung
        // =================================================================
        if (score.verdict) {
            html += `
                <div class="result-section verdict-section">
                    <div class="verdict-box">
                        <h4><i class="fa-solid fa-comment-dots"></i> Was bedeutet das?</h4>
                        <p>${esc(score.verdict)}</p>
                    </div>
                </div>
            `;
        }

        // =================================================================
        // ENGINE-KARTEN: Gemini vs ChatGPT Detail
        // =================================================================
        const ed = data.engineDetails;
        if (ed) {
            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-chart-pie"></i> KI-Sichtbarkeit im Detail</h3>
                    <div class="engine-cards-row">
                        <div class="engine-detail-card">
                            <div class="engine-detail-name"><span class="engine-dot" style="background:#4285f4"></span> Gemini</div>
                            <div class="engine-check-row">
                                <span class="engine-check-label">Bekanntheit <span class="engine-weight">60%</span></span>
                                <span class="engine-check-icon ${ed.gemini.knowledge ? 'found' : 'notfound'}">${ed.gemini.knowledge ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'}</span>
                            </div>
                            <div class="engine-check-row">
                                <span class="engine-check-label">Erwähnungen <span class="engine-weight">25%</span></span>
                                <span class="engine-check-icon ${ed.gemini.mentions ? 'found' : 'notfound'}">${ed.gemini.mentions ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'}</span>
                            </div>
                            <div class="engine-check-row">
                                <span class="engine-check-label">Reputation <span class="engine-weight">15%</span></span>
                                <span class="engine-check-icon ${ed.gemini.reviews ? 'found' : 'notfound'}">${ed.gemini.reviews ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'}</span>
                            </div>
                        </div>
                        ${ed.chatgpt ? `
                        <div class="engine-detail-card">
                            <div class="engine-detail-name"><span class="engine-dot" style="background:#10a37f"></span> ChatGPT</div>
                            <div class="engine-check-row">
                                <span class="engine-check-label">Bekanntheit <span class="engine-weight">60%</span></span>
                                <span class="engine-check-icon ${ed.chatgpt.knowledge ? 'found' : 'notfound'}">${ed.chatgpt.knowledge ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'}</span>
                            </div>
                            <div class="engine-check-row">
                                <span class="engine-check-label">Erwähnungen <span class="engine-weight">25%</span></span>
                                <span class="engine-check-icon ${ed.chatgpt.mentions ? 'found' : 'notfound'}">${ed.chatgpt.mentions ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'}</span>
                            </div>
                            <div class="engine-check-row">
                                <span class="engine-check-label">Reputation <span class="engine-weight">15%</span></span>
                                <span class="engine-check-icon ${ed.chatgpt.reviews ? 'found' : 'notfound'}">${ed.chatgpt.reviews ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>'}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    <p class="engine-range-note">Score-Range statt Einzelwert — KI-Antworten variieren bei jeder Abfrage leicht</p>
                </div>
            `;
        }

        // =================================================================
        // SCORE-ZUSAMMENSETZUNG (kompakter)
        // =================================================================
        html += `
            <div class="result-section">
                <h3><i class="fa-solid fa-layer-group"></i> Score-Zusammensetzung</h3>
                <div class="breakdown-grid">
                    ${score.breakdown.map(item => {
                        const points = parseInt(item.points) || 0;
                        const maxPoints = parseInt(item.maxPoints) || 1;
                        const fillWidth = Math.min(100, (points / maxPoints) * 100);
                        const fillColor = fillWidth >= 70 ? '#22c55e' : fillWidth >= 40 ? '#f59e0b' : '#ef4444';
                        const categoryColors = {
                            'Gemini Sichtbarkeit': '#4285f4',
                            'ChatGPT Sichtbarkeit': '#10a37f',
                            'Technische Authority': '#8b5cf6',
                            'Online-Reputation': '#f59e0b'
                        };
                        const barColor = categoryColors[item.category] || fillColor;
                        
                        return `
                            <div class="breakdown-item">
                                <div class="breakdown-header">
                                    <span class="breakdown-label">${esc(item.category)}</span>
                                    <span class="breakdown-points" style="color: ${fillColor}">${points}/${maxPoints}</span>
                                </div>
                                <div class="breakdown-bar">
                                    <div class="breakdown-fill" style="width: ${fillWidth}%; background: linear-gradient(90deg, ${barColor}88, ${barColor})"></div>
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
        // =================================================================
        if (hasChatGPT) {
            const geminiKnowledge = geminiTests.find(t => t.id === 'knowledge');
            const chatgptKnowledge = chatgptTests.find(t => t.id === 'chatgpt_knowledge');
            const geminiReputation = geminiTests.find(t => t.id === 'reviews');
            const chatgptReputation = chatgptTests.find(t => t.id === 'chatgpt_reviews');
            const geminiExternal = geminiTests.find(t => t.id === 'mentions');
            const chatgptExternal = chatgptTests.find(t => t.id === 'chatgpt_mentions');

            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-code-compare"></i> KI-Vergleich: Gemini vs. ChatGPT</h3>
                    <p class="section-intro">${data.hasDomain ? 'Kennen die großen KI-Systeme deine Domain?' : 'Kennen die großen KI-Systeme deinen Namen?'}</p>
                    
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
                                    <td class="comparison-td" data-engine="gemini">
                                        <span class="mobile-label engine-gemini">GEMINI</span>
                                        ${statusPill(geminiKnowledge)}
                                        <br>${sentimentDot(geminiKnowledge)}
                                    </td>
                                    <td class="comparison-td" data-engine="chatgpt">
                                        <span class="mobile-label engine-chatgpt">CHATGPT</span>
                                        ${statusPill(chatgptKnowledge)}
                                        <br>${sentimentDot(chatgptKnowledge)}
                                    </td>
                                </tr>
                                <tr>
                                    <td class="comparison-td-left">
                                        <i class="fa-solid fa-star comparison-icon"></i>
                                        Reputation
                                    </td>
                                    <td class="comparison-td" data-engine="gemini">
                                        <span class="mobile-label engine-gemini">GEMINI</span>
                                        ${statusPill(geminiReputation)}
                                        <br>${sentimentDot(geminiReputation)}
                                    </td>
                                    <td class="comparison-td" data-engine="chatgpt">
                                        <span class="mobile-label engine-chatgpt">CHATGPT</span>
                                        ${statusPill(chatgptReputation)}
                                        <br>${sentimentDot(chatgptReputation)}
                                    </td>
                                </tr>
                                <tr>
                                    <td class="comparison-td-left">
                                        <i class="fa-solid fa-link comparison-icon"></i>
                                        Ext. Erwähnungen
                                    </td>
                                    <td class="comparison-td" data-engine="gemini">
                                        <span class="mobile-label engine-gemini">GEMINI</span>
                                        ${statusPill(geminiExternal)}
                                        <br>${sentimentDot(geminiExternal)}
                                    </td>
                                    <td class="comparison-td" data-engine="chatgpt">
                                        <span class="mobile-label engine-chatgpt">CHATGPT</span>
                                        ${statusPill(chatgptExternal)}
                                        <br>${sentimentDot(chatgptExternal)}
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
        if (data.hasDomain) {
        // Wertvolle Typen als Set (lower-case) für schnellen Lookup beim Rendern
        const valuableSet = new Set(
            (domainAnalysis.schema.valuableTypes || []).map(t => String(t).toLowerCase())
        );

        // Crawler-Karte: Daten vorbereiten (kann null sein, wenn robots.txt-Check fehlgeschlagen)
        const ca = crawlerAccess || {};
        const robotsFound = !!ca.robotsTxtFound;
        const llmsFound   = !!ca.llmsTxtFound;
        const blocked     = Array.isArray(ca.blockedCrawlers) ? ca.blockedCrawlers : [];
        const allowed     = Array.isArray(ca.allowedCrawlers) ? ca.allowedCrawlers : [];
        const crawlerError = ca.error || null;

        html += `
            <div class="result-section">
                <h3><i class="fa-solid fa-magnifying-glass-chart"></i> Domain-Analyse</h3>
                
                <div class="analysis-grid">
                    <div class="analysis-card">
                        <h4>Schema.org</h4>
                        <div class="analysis-status ${domainAnalysis.schema.found ? 'status-good' : 'status-bad'}">
                            <i class="fa-solid ${domainAnalysis.schema.found ? 'fa-check' : 'fa-xmark'}"></i>
                            ${domainAnalysis.schema.found ? 'Vorhanden' : 'Nicht gefunden'}
                            ${domainAnalysis.schema.found && domainAnalysis.schema.valuableCount > 0 ? `
                                <span class="schema-valuable-badge">${domainAnalysis.schema.valuableCount} wertvoll</span>
                            ` : ''}
                        </div>
                        ${domainAnalysis.schema.types.length > 0 ? `
                            <div class="schema-types">
                                ${domainAnalysis.schema.types.map(t => {
                                    const isValuable = valuableSet.has(String(t).toLowerCase());
                                    const cls = isValuable ? 'schema-tag schema-tag-valuable' : 'schema-tag schema-tag-neutral';
                                    const icon = isValuable ? '<i class="fa-solid fa-star"></i>' : '';
                                    const title = isValuable
                                        ? 'Wertvoller Typ für KI-Sichtbarkeit'
                                        : 'Struktureller Typ (neutral)';
                                    return `<span class="${cls}" title="${title}">${icon}${esc(t)}</span>`;
                                }).join('')}
                            </div>
                            <p class="schema-legend">
                                <i class="fa-solid fa-star"></i> KI-relevant &nbsp;·&nbsp; ohne Stern: strukturell
                            </p>
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

                    <div class="analysis-card">
                        <h4>KI-Crawler & Standards</h4>
                        ${crawlerError ? `
                            <div class="analysis-status status-bad">
                                <i class="fa-solid fa-triangle-exclamation"></i>
                                robots.txt-Check fehlgeschlagen
                            </div>
                            <p class="crawler-note">${esc(crawlerError)}</p>
                        ` : `
                            <ul class="eeat-list">
                                <li class="${robotsFound ? 'check' : 'missing'}">
                                    <i class="fa-solid ${robotsFound ? 'fa-check' : 'fa-xmark'}"></i>
                                    robots.txt ${robotsFound ? 'gefunden' : 'nicht gefunden'}
                                </li>
                                <li class="${llmsFound ? 'check' : 'missing'}">
                                    <i class="fa-solid ${llmsFound ? 'fa-check' : 'fa-xmark'}"></i>
                                    llms.txt ${llmsFound ? 'gefunden' : 'nicht vorhanden'}
                                </li>
                            </ul>
                            ${robotsFound ? `
                                <div class="crawler-section">
                                    ${blocked.length === 0 ? `
                                        <p class="crawler-note crawler-note-good">
                                            <i class="fa-solid fa-check"></i>
                                            Alle ${allowed.length} geprüften KI-Crawler sind erlaubt
                                        </p>
                                    ` : `
                                        <p class="crawler-note crawler-note-warn">
                                            <i class="fa-solid fa-ban"></i>
                                            ${blocked.length} KI-Crawler blockiert:
                                        </p>
                                        <div class="crawler-tags">
                                            ${blocked.map(b => `
                                                <span class="crawler-tag crawler-tag-blocked" title="${esc(b.vendor || '')} – ${esc(b.purpose || '')}">
                                                    <i class="fa-solid fa-ban"></i>${esc(b.name)}
                                                </span>
                                            `).join('')}
                                        </div>
                                    `}
                                </div>
                            ` : ''}
                        `}
                    </div>
                </div>
            </div>
        `;
        } // end hasDomain

        // =================================================================
        // GEMINI TESTS
        // =================================================================
        html += `
            <div class="result-section">
                <h3><span class="engine-badge engine-gemini">Gemini</span> Live-Tests mit Google-Suche</h3>
                <p class="section-intro">Gemini durchsucht das Web live (Grounding) und prüft deine Sichtbarkeit:</p>
                
                <div class="tests-accordion">
                    ${geminiTests.map((test, index) => {
                        const safeSentiment = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehlend', 'fehler']);
                        return `
                        <details class="test-item ${sentimentIcon(test).cls}" ${index === 0 ? 'open' : ''}>
                            <summary>
                                <span class="test-status">
                                    <i class="fa-solid ${sentimentIcon(test).icon}"></i>
                                </span>
                                <span class="test-name">${esc(test.description)}</span>
                                <span class="test-sentiment sentiment-${safeSentiment}">${esc(safeSentiment)}</span>
                                <span class="test-toggle"><i class="fa-solid fa-chevron-down"></i></span>
                            </summary>
                            <div class="test-content">
                                <div class="test-response">${sanitizeHTML(test.response)}</div>
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
        // =================================================================
        if (hasChatGPT) {
            const chatgptKnown = chatgptTests.find(t => t.id === 'chatgpt_knowledge')?.mentioned;
            
            const chatgptInsightClass = chatgptKnown ? 'chatgpt-insight-positive' : 'chatgpt-insight-negative';
            const chatgptInsightIcon = chatgptKnown ? '🟢' : '⚠';
            const chatgptInsightTitle = chatgptKnown 
                ? 'Von ChatGPT gefunden' 
                : 'Von ChatGPT nicht gefunden';
            const chatgptInsightText = chatgptKnown 
                ? 'ChatGPT findet dein Unternehmen. Du bist auch für ChatGPT-Nutzer sichtbar.'
                : data.hasDomain 
                    ? 'ChatGPT findet deine Domain nicht. Nutzer von ChatGPT sehen bei Branchenanfragen nur Alternativen. Mehr externe Erwähnungen und strukturierte Daten können helfen.'
                    : 'ChatGPT findet diesen Namen nicht. Nutzer von ChatGPT sehen bei Branchenanfragen nur Alternativen. Mehr externe Erwähnungen, eine eigene Website und strukturierte Daten können helfen.';

            html += `
                <div class="result-section">
                    <h3><span class="engine-badge engine-chatgpt">ChatGPT</span> Web-Check</h3>
                    <p class="section-intro">ChatGPT durchsucht das Web und prüft, ob du bekannt bist:</p>
                    
                    <div class="${chatgptInsightClass}">
                        <strong>${chatgptInsightIcon} ${chatgptInsightTitle}</strong><br>
                        ${chatgptInsightText}
                    </div>
                    
                    <div class="tests-accordion">
                        ${chatgptTests.map((test, index) => {
                            const safeSentiment = safeClass(test.sentiment, ['positiv', 'neutral', 'negativ', 'fehlend', 'fehler']);
                            return `
                            <details class="test-item ${sentimentIcon(test).cls}" ${index === 0 ? 'open' : ''}>
                                <summary>
                                    <span class="test-status">
                                        <i class="fa-solid ${sentimentIcon(test).icon}"></i>
                                    </span>
                                    <span class="test-name">${esc(test.description)}</span>
                                    <span class="test-sentiment sentiment-${safeSentiment}">${esc(safeSentiment)}</span>
                                    <span class="test-toggle"><i class="fa-solid fa-chevron-down"></i></span>
                                </summary>
                                <div class="test-content">
                                    <div class="test-response">${sanitizeHTML(test.response)}</div>
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
        // KONKURRENTEN
        // =================================================================
        if (competitors.length > 0) {
            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-users"></i> Alternativen in KI-Antworten</h3>
                    <p class="section-intro">${data.hasDomain ? 'Diese Domains werden statt deiner erwähnt:' : 'Diese Domains tauchen in den KI-Antworten zu diesem Namen auf:'}</p>
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
        // EMPFEHLUNGEN
        // =================================================================
        if (recommendations.length > 0) {
            html += `
                <div class="result-section">
                    <h3><i class="fa-solid fa-lightbulb"></i> Deine Top-Hebel</h3>
                    <div class="recommendations-list">
                        ${recommendations.slice(0, 5).map((rec, i) => {
                            const safePriority = safeClass(rec.priority, ['hoch', 'mittel']);
                            return `
                            <div class="recommendation-card priority-${safePriority}">
                                <div class="rec-number">${i + 1}</div>
                                <div class="rec-content">
                                    <h4>${esc(rec.title)}</h4>
                                    <p>${esc(rec.description)}</p>
                                    ${rec.pointPotential ? `<span class="rec-potential"><i class="fa-solid fa-arrow-trend-up"></i> Potenzial: ${esc(rec.pointPotential)}</span>` : ''}
                                    ${rec.link ? `<a href="${safeHref(rec.link)}" class="rec-link">Mehr erfahren <i class="fa-solid fa-arrow-right"></i></a>` : ''}
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>
            `;
        }

        // =================================================================
        // E-MAIL REPORT FORMULAR
        // =================================================================
        html += `
            <div class="result-section email-report-section">
                <h3><i class="fa-solid fa-envelope"></i> Ergebnis per E-Mail sichern</h3>
                <p class="section-intro">Erhalte deine komplette Auswertung als E-Mail – inkl. Score, KI-Tests und Empfehlungen.</p>
                
                <form id="email-report-form" class="email-report-form">
                    <div class="email-report-row">
                        <input 
                            type="email" 
                            id="report-email-input" 
                            class="form-input email-report-input"
                            placeholder="deine@email.at"
                            required
                        >
                        <button type="submit" id="send-report-btn" class="send-report-btn">
                            <i class="fa-solid fa-paper-plane"></i> Senden
                        </button>
                    </div>
                    <label class="email-consent-label">
                        <input type="checkbox" id="email-consent" required>
                        <span>Ich bin damit einverstanden, dass meine E-Mail-Adresse zur Zustellung der Auswertung verwendet wird. <a href="/datenschutz" target="_blank">Datenschutz</a></span>
                    </label>
                    <div id="email-report-status" class="email-report-status"></div>
                </form>
            </div>
        `;

        // =================================================================
        // FOOTER 
        // =================================================================
        html += `
            <div class="result-footer">
                <p><i class="fa-solid fa-clock"></i> Analyse vom ${formatTimestamp(data.timestamp)}${data.cached ? ' <span class="cache-badge"><i class="fa-solid fa-bolt"></i> aus Cache</span>' : ''}</p>
                <p class="disclaimer">Hinweis: KI-Antworten variieren. Dieser Test ist eine Momentaufnahme.${hasChatGPT ? ' Beide KIs durchsuchen das Web live.' : ''}</p>
            </div>
        `;

        resultsContainer.innerHTML = html;

        // Animate score ring
        setTimeout(() => {
            document.querySelector('.score-ring-progress')?.classList.add('animated');
        }, 100);

        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // =================================================================
        // E-MAIL REPORT HANDLER
        // =================================================================
        const emailForm = document.getElementById('email-report-form');
        if (emailForm) {
            emailForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const emailInput = document.getElementById('report-email-input');
                const consentBox = document.getElementById('email-consent');
                const sendBtn = document.getElementById('send-report-btn');
                const statusEl = document.getElementById('email-report-status');
                const email = emailInput.value.trim();

                if (!email || !consentBox.checked) return;

                sendBtn.disabled = true;
                sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Wird gesendet...';
                statusEl.className = 'email-report-status';
                statusEl.textContent = '';

                try {
                    if (!reportToken) {
                        throw new Error('Report-Token fehlt. Bitte Analyse neu starten.');
                    }

                    const res = await fetch('/api/send-visibility-report', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email,
                            reportToken,
                            domain: domainInput.value.trim() || null,
                            brandName: brandInput?.value.trim() || null,
                            standort: locationInput?.value.trim() || null,
                            industry: industryInput.value.trim() || null
                        })
                    });

                    const result = await res.json();

                    if (result.success) {
                        statusEl.className = 'email-report-status status-success';
                        statusEl.innerHTML = '<i class="fa-solid fa-check"></i> ';
                        statusEl.appendChild(document.createTextNode('Auswertung wurde gesendet!'));
                        emailForm.querySelector('.email-report-row').style.display = 'none';
                        emailForm.querySelector('.email-consent-label').style.display = 'none';
                    } else {
                        throw new Error(result.message || 'Senden fehlgeschlagen');
                    }
                } catch (err) {
                    statusEl.className = 'email-report-status status-error';
                    statusEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ';
                    statusEl.appendChild(document.createTextNode(String(err.message || 'Senden fehlgeschlagen')));
                    sendBtn.disabled = false;
                    sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Senden';
                }
            });
        }
    }
});
