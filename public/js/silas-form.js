// js/silas-form.js - FINALE VERSION (Button Links)
// Passwort-Authentifizierung über Lightbox & API (check-auth.js)

export function initSilasForm() {
    const silasForm = document.getElementById('silas-form');
    if (!silasForm) return;

    // KONFIGURATION & LIMITS
    let DEMO_LIMITS = { maxKeywordsPerSession: 3, maxGenerationsPerHour: 5, maxGenerationsPerDay: 10, cooldownBetweenRequests: 30000 };
    const MASTER_LIMITS = { maxKeywordsPerSession: 50, maxGenerationsPerHour: 100, maxGenerationsPerDay: 500, cooldownBetweenRequests: 1000 };
    
    // DOM-ELEMENTE
    const keywordInput = document.getElementById('silas-keyword-input');
    const keywordDisplayList = document.getElementById('keyword-display-list');
    const startGenerationBtn = document.getElementById('start-generation-btn');
    const clearListBtn = document.getElementById('clear-list-btn');
    const silasStatus = document.getElementById('silas-status');
    const silasResponseContainer = document.getElementById('silas-response-container');
    const previewModal = document.getElementById('silas-preview-modal');
    const closePreviewModalBtn = document.getElementById('close-preview-modal');
    const previewContentArea = document.getElementById('preview-content-area');
    const authModal = document.getElementById('silas-auth-modal');
    const closeAuthModalBtn = document.getElementById('close-auth-modal');
    const masterPwdInput = document.getElementById('master-pwd-input');
    const confirmUnlockBtn = document.getElementById('confirm-unlock-btn');
    const authErrorMsg = document.getElementById('auth-error-msg');
    const textIntentSelect = document.getElementById('text-intent-select');
    const zielgruppeInput = document.getElementById('text-zielgruppe-input');
    const tonalitaetInput = document.getElementById('text-tonalitaet-input');
    const uspInput = document.getElementById('text-usp-input');
    const domainInput = document.getElementById('text-domain-input');
    const brandInput = document.getElementById('text-brand-input');
    const emailInput = document.getElementById('text-email-input');
    const phoneInput = document.getElementById('text-phone-input');
    const addressInput = document.getElementById('text-adress-input'); 
    const grammaticalPersonSelect = document.getElementById('grammatical-person-select');
    const readabilitySelect = document.getElementById('readability-select');
    const customStyleInput = document.getElementById('custom-style-input');
    const templateSelector = document.getElementById('template-selector');

    let keywordList = [];
    let allGeneratedData = [];

    // === MASTER MODE LOGIK ===
    function isMasterModeActive() {
        const masterMode = sessionStorage.getItem('silas_master_mode');
        const timestamp = parseInt(sessionStorage.getItem('silas_master_timestamp') || '0');
        if (masterMode === 'true' && (Date.now() - timestamp) < (8 * 60 * 60 * 1000)) return true;
        if (masterMode === 'true') {
            sessionStorage.removeItem('silas_master_mode');
            sessionStorage.removeItem('silas_master_timestamp');
        }
        return false;
    }

    if (isMasterModeActive()) DEMO_LIMITS = Object.assign({}, MASTER_LIMITS);

    function createMasterPasswordUI() {
        if (!isMasterModeActive() && !document.getElementById('master-unlock-btn')) {
            const unlockBtn = document.createElement('button');
            unlockBtn.id = 'master-unlock-btn';
            unlockBtn.innerHTML = '<i class="fas fa-lock"></i>';
            unlockBtn.title = 'Master Access';
            
            // ÄNDERUNG HIER: right:20px -> left:20px
            unlockBtn.style.cssText = 'position:fixed;bottom:40px;left:20px;background:linear-gradient(135deg,var(--accent-color) 0%,#d4a84a 100%);border:2px solid var(--accent-color);color:var(--bg-color);width:50px;height:50px;border-radius:50%;cursor:pointer;font-size:1.2rem;box-shadow:0 4px 15px rgba(196,163,90,0.3);transition:all 0.3s ease;z-index:1000;';
            
            unlockBtn.onclick = () => openAuthModal();
            document.body.appendChild(unlockBtn);
        }
        if (isMasterModeActive()) showMasterModeIndicator();
    }

    // === AUTH MODAL (LIGHTBOX) ===
    function openAuthModal() {
        if (!authModal) return;
        if (masterPwdInput) masterPwdInput.value = '';
        if (authErrorMsg) authErrorMsg.style.display = 'none';
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        authModal.style.display = 'flex';
        requestAnimationFrame(() => {
            authModal.classList.add('visible');
            if (masterPwdInput) masterPwdInput.focus();
        });
    }

    function closeAuthModal() {
        if (!authModal) return;
        authModal.classList.remove('visible');
        setTimeout(() => {
            authModal.style.display = 'none';
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
        }, 300);
    }

    if (closeAuthModalBtn) closeAuthModalBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closeAuthModal(); });
    if (authModal) authModal.addEventListener('click', e => { if (e.target === authModal) closeAuthModal(); });
    if (masterPwdInput) masterPwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); validatePassword(); } });
    if (confirmUnlockBtn) confirmUnlockBtn.addEventListener('click', e => { e.preventDefault(); validatePassword(); });

    async function validatePassword() {
        const password = masterPwdInput ? masterPwdInput.value : '';
        if (!password) { showAuthError('Bitte Passwort eingeben'); return; }
        if (confirmUnlockBtn) { confirmUnlockBtn.disabled = true; confirmUnlockBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Prüfe...'; }
        try {
            const response = await fetch('/api/check-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
            
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('API nicht erreichbar');
            }
            
            const result = await response.json();
            if (response.ok && result.success) { closeAuthModal(); activateMasterMode(); }
            else { showAuthError(result.message || 'Falsches Passwort'); }
        } catch (error) { console.error('Auth-Fehler:', error); showAuthError('API-Fehler: ' + error.message); }
        finally { if (confirmUnlockBtn) { confirmUnlockBtn.disabled = false; confirmUnlockBtn.innerHTML = '<i class="fas fa-unlock"></i> Freischalten'; } }
    }

    function showAuthError(msg) {
        if (authErrorMsg) { authErrorMsg.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + msg; authErrorMsg.style.display = 'block'; }
        if (masterPwdInput) { masterPwdInput.style.borderColor = '#ff6b6b'; setTimeout(() => masterPwdInput.style.borderColor = '', 2000); }
    }

    function activateMasterMode() {
        sessionStorage.setItem('silas_master_mode', 'true');
        sessionStorage.setItem('silas_master_timestamp', Date.now().toString());
        DEMO_LIMITS = Object.assign({}, MASTER_LIMITS);
        ['silas_daily', 'silas_hourly', 'silas_last_request'].forEach(item => localStorage.removeItem(item));
        showMasterModeIndicator(); hideUnlockButton(); showDemoStatus();
        showNotification('Master Mode aktiviert!', 'success');
    }

    function showMasterModeIndicator() {
        document.getElementById('master-mode-indicator')?.remove();
        const indicator = document.createElement('div');
        indicator.id = 'master-mode-indicator';
        indicator.className = 'info-box';
        indicator.style.cssText = 'background:rgba(40,167,69,0.1);border:1px solid #28a745;margin:1.5rem 0;';
        indicator.innerHTML = '<i class="fas fa-unlock" style="color:#28a745;"></i><div style="flex-grow:1;"><strong style="color:#28a745;">MASTER MODE AKTIV</strong><p style="margin:0;font-size:0.9rem;color:var(--text-color-muted);">Unlimited Keywords • No Rate Limits</p></div><button id="deactivate-master-btn" style="background:transparent;border:1px solid #28a745;color:#28a745;padding:0.5rem 1rem;border-radius:4px;cursor:pointer;">Deaktivieren</button>';
        const target = document.querySelector('.silas-generator-section') || silasForm?.parentNode;
        if (target) target.insertBefore(indicator, target.querySelector('.ai-container') || silasForm);
        document.getElementById('deactivate-master-btn')?.addEventListener('click', () => { if (confirm('Master Mode deaktivieren?')) { sessionStorage.removeItem('silas_master_mode'); sessionStorage.removeItem('silas_master_timestamp'); location.reload(); } });
    }

    function hideUnlockButton() { const btn = document.getElementById('master-unlock-btn'); if (btn) btn.style.display = 'none'; }
    function showNotification(msg, type = 'info') {
        const colors = { success: '#28a745', error: '#ff6b6b', info: 'var(--accent-color)' };
        const n = document.createElement('div');
        n.style.cssText = 'position:fixed;top:20px;right:20px;background:' + (colors[type] || colors.info) + ';color:white;padding:15px 25px;border-radius:8px;font-weight:500;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
        n.innerHTML = '<i class="fas fa-check-circle"></i> ' + msg;
        document.body.appendChild(n);
        setTimeout(() => n.remove(), 4000);
    }

    // === TRACKING & LIMITS ===
    function initDemoTracking() {
        const today = new Date().toDateString();
        const dailyData = JSON.parse(localStorage.getItem('silas_daily') || '{}');
        if (dailyData.date !== today) localStorage.setItem('silas_daily', JSON.stringify({ date: today, count: 0 }));
        const hourlyData = JSON.parse(localStorage.getItem('silas_hourly') || '{}');
        const currentHour = Math.floor(Date.now() / 3600000);
        if (hourlyData.hour !== currentHour) localStorage.setItem('silas_hourly', JSON.stringify({ hour: currentHour, count: 0 }));
    }

    function checkRateLimit() {
        if (isMasterModeActive()) return true;
        const now = Date.now();
        const dailyData = JSON.parse(localStorage.getItem('silas_daily') || '{}');
        const hourlyData = JSON.parse(localStorage.getItem('silas_hourly') || '{}');
        const lastRequest = parseInt(localStorage.getItem('silas_last_request') || '0');
        if (now - lastRequest < DEMO_LIMITS.cooldownBetweenRequests) throw new Error('Bitte warte noch ' + Math.ceil((DEMO_LIMITS.cooldownBetweenRequests - (now - lastRequest)) / 1000) + ' Sekunden.');
        if (dailyData.count >= DEMO_LIMITS.maxGenerationsPerDay) throw new Error('Tägliches Demo-Limit erreicht.');
        if (hourlyData.count >= DEMO_LIMITS.maxGenerationsPerHour) throw new Error('Stündliches Demo-Limit erreicht.');
        return true;
    }

    function updateUsageCounters() {
        const dailyData = JSON.parse(localStorage.getItem('silas_daily') || '{}');
        dailyData.count = (dailyData.count || 0) + 1;
        localStorage.setItem('silas_daily', JSON.stringify(dailyData));
        const hourlyData = JSON.parse(localStorage.getItem('silas_hourly') || '{}');
        hourlyData.count = (hourlyData.count || 0) + 1;
        localStorage.setItem('silas_hourly', JSON.stringify(hourlyData));
        localStorage.setItem('silas_last_request', Date.now().toString());
        showDemoStatus();
    }

    function showDemoStatus() {
        const dailyData = JSON.parse(localStorage.getItem('silas_daily') || '{}');
        const hourlyData = JSON.parse(localStorage.getItem('silas_hourly') || '{}');
        const dailyRemaining = DEMO_LIMITS.maxGenerationsPerDay - (dailyData.count || 0);
        const hourlyRemaining = DEMO_LIMITS.maxGenerationsPerHour - (hourlyData.count || 0);
        let container = document.getElementById('silas-demo-status');
        if (!container) {
            container = document.createElement('div');
            container.id = 'silas-demo-status';
            const target = document.querySelector('.silas-generator-section') || silasForm?.parentNode;
            if (target) target.insertBefore(container, target.querySelector('.ai-container') || silasForm);
        }
        if (isMasterModeActive()) { container.innerHTML = ''; }
        else { container.innerHTML = '<div class="tech-box" style="margin:1.5rem 0;"><i class="fas fa-flask" style="color:var(--accent-color);"></i><div><strong>Demo-Modus:</strong><p style="margin:0;">Heute noch <strong>' + dailyRemaining + '</strong> | Diese Stunde noch <strong>' + hourlyRemaining + '</strong></p></div></div>'; }
    }

    function validateKeyword(kw) {
        if (isMasterModeActive()) { if (kw.length > 100) throw new Error('Keyword zu lang.'); return true; }
        const forbidden = ['adult', 'porn', 'sex', 'drugs', 'illegal', 'hack', 'crack', 'bitcoin', 'crypto', 'gambling', 'casino', 'pharma'];
        if (forbidden.some(t => kw.toLowerCase().includes(t))) throw new Error('Keyword nicht erlaubt.');
        if (kw.length > 50) throw new Error('Keywords max. 50 Zeichen.');
        if (!/^[a-zA-ZäöüÄÖÜß\s\-_0-9]+$/.test(kw)) throw new Error('Ungültige Zeichen im Keyword.');
        return true;
    }

    // === KEYWORD MANAGEMENT ===
    function addKeywords() {
        try {
            const newKeywords = keywordInput.value.split(',').map(kw => kw.trim()).filter(Boolean);
            if (newKeywords.length === 0) return;
            const formValues = {
                zielgruppe: zielgruppeInput?.value.trim() || '',
                tonalitaet: tonalitaetInput?.value.trim() || '',
                usp: uspInput?.value.trim() || '',
                intent: textIntentSelect?.value || 'informational',
                domain: domainInput?.value.trim() || '',
                brand: brandInput?.value.trim() || '',
                email: emailInput?.value.trim() || '',
                phone: phoneInput?.value.trim() || '',
                address: addressInput?.value.trim() || '',
                grammaticalPerson: grammaticalPersonSelect?.value || 'singular',
                readability: readabilitySelect?.value || 'balanced',
                customStyle: customStyleInput?.value.trim() || ''
            };
            newKeywords.forEach(validateKeyword);
            if (!isMasterModeActive() && (keywordList.length + newKeywords.length) > DEMO_LIMITS.maxKeywordsPerSession) throw new Error('Demo-Limit: Max ' + DEMO_LIMITS.maxKeywordsPerSession + ' Keywords.');
            newKeywords.forEach(kw => {
                const idx = keywordList.findIndex(item => item.keyword === kw);
                const data = { keyword: kw, ...formValues };
                if (idx === -1) keywordList.push(data); else keywordList[idx] = data;
            });
            updateKeywordDisplay();
            keywordInput.value = '';
            silasStatus.textContent = newKeywords.length + ' Keyword(s) hinzugefügt.';
            silasStatus.style.color = 'var(--accent-color)';
            setTimeout(() => silasStatus.textContent = 'Bereit zur Generierung.', 2000);
        } catch (error) {
            silasStatus.textContent = error.message;
            silasStatus.style.color = '#ff6b6b';
            setTimeout(() => { silasStatus.textContent = 'Bereit zur Generierung.'; silasStatus.style.color = 'var(--accent-color)'; }, 4000);
        }
    }

    function updateKeywordDisplay() {
        keywordDisplayList.innerHTML = '';
        keywordList.forEach((item, index) => {
            const li = document.createElement('li');
            li.style.cssText = 'background:rgba(255,255,255,0.03);margin-bottom:12px;padding:15px;display:flex;align-items:center;justify-content:space-between;border-left:3px solid ' + (item.intent === 'commercial' ? '#28a745' : 'var(--accent-color)') + ';';
            li.innerHTML = '<div style="flex-grow:1;"><span style="font-weight:500;">' + item.keyword + '</span></div><button class="remove-btn" data-index="' + index + '" style="background:transparent;color:#ff6b6b;border:1px solid #ff6b6b;width:32px;height:32px;cursor:pointer;">×</button>';
            keywordDisplayList.appendChild(li);
        });
        clearListBtn.style.display = keywordList.length > 0 ? 'inline-block' : 'none';
    }

    // === TEMPLATES ===
    const STYLE_TEMPLATES = {
        'emotional': "Stell dir vor, du wachst morgens auf und fühlst dich endlich ausgeschlafen...",
        'hard-facts': "Mit [PRODUKT] steigern Sie Ihre Effizienz nachweislich um 20%...",
        'du-ansprache': "Hey! Hast du auch keine Lust mehr auf komplizierte Lösungen?...",
        'serioes': "Die [UNTERNEHMEN] steht seit über 25 Jahren für Exzellenz..."
    };
    if (templateSelector && customStyleInput) {
        templateSelector.addEventListener('change', e => {
            if (STYLE_TEMPLATES[e.target.value]) customStyleInput.value = STYLE_TEMPLATES[e.target.value];
            else if (e.target.value === '') customStyleInput.value = '';
        });
    }

    // === GENERIERUNG ===
    startGenerationBtn.addEventListener('click', async function() {
        try {
            if (keywordList.length === 0) { silasStatus.textContent = 'Bitte Keywords hinzufügen.'; silasStatus.style.color = '#ff6b6b'; return; }
            checkRateLimit();
            startGenerationBtn.disabled = true;
            clearListBtn.disabled = true;
            allGeneratedData = [];
            silasResponseContainer.innerHTML = '<h3 style="color:var(--accent-color);"><i class="fas fa-spinner fa-spin"></i> Erstellung läuft...</h3><div id="silas-response-content"></div>';
            silasResponseContainer.style.display = 'block';
            silasStatus.textContent = 'Sende ' + keywordList.length + ' Keywords...';
            const headers = { 'Content-Type': 'application/json' };
            if (isMasterModeActive()) headers['X-Silas-Master'] = 'true';
            
            // Parallel Request
            const response = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify({ keywords: keywordList }) });
            
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Server-Fehler: API nicht erreichbar (Status ' + response.status + ')');
            }
            
            const results = await response.json();
            if (!response.ok) throw new Error(results.error || 'Server-Fehler: ' + response.status);
            
            allGeneratedData = results;
            silasResponseContainer.querySelector('h3').innerHTML = '<i class="fas fa-check-circle"></i> Fertig!';
            const content = document.getElementById('silas-response-content');
            content.innerHTML = '';
            results.forEach((data, i) => displayResult(data, i, content));
            updateUsageCounters();
            silasStatus.textContent = 'Alle ' + keywordList.length + ' Texte verarbeitet.';
            if (allGeneratedData.some(d => !d.error)) {
                const dc = document.createElement('div');
                dc.style.cssText = 'margin-top:2rem;display:flex;flex-direction:column;gap:1rem;align-items:center;';
                dc.innerHTML = '<button id="download-csv-btn" class="cta-button" style="max-width:400px;width:100%;"><i class="fas fa-download"></i> CSV</button><button id="download-txt-btn" class="cta-button" style="max-width:400px;width:100%;"><i class="fas fa-file-alt"></i> TXT</button>';
                silasResponseContainer.appendChild(dc);
                document.getElementById('download-csv-btn').onclick = downloadCsv;
                document.getElementById('download-txt-btn').onclick = downloadTxt;
            }
        } catch (error) {
            silasStatus.textContent = 'Fehler: ' + error.message;
            silasStatus.style.color = '#ff6b6b';
        } finally { startGenerationBtn.disabled = false; clearListBtn.disabled = false; }
    });

    // === PREVIEW MODAL ===
    function openPreviewModal() {
        if (!previewModal) return;
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
        previewModal.style.display = 'flex';
        requestAnimationFrame(() => previewModal.classList.add('visible'));
    }
    function closePreviewModal() {
        if (!previewModal) return;
        previewModal.classList.remove('visible');
        setTimeout(() => { previewModal.style.display = 'none'; document.body.classList.remove('modal-open'); document.body.style.overflow = ''; }, 300);
    }
    if (closePreviewModalBtn) closePreviewModalBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); closePreviewModal(); });
    if (previewModal) previewModal.addEventListener('click', e => { if (e.target === previewModal) closePreviewModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (previewModal?.classList.contains('visible')) closePreviewModal(); if (authModal?.classList.contains('visible')) closeAuthModal(); } });

    silasResponseContainer.addEventListener('click', function(e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        const idx = parseInt(btn.getAttribute('data-index'));
        const data = allGeneratedData[idx];
        if (btn.classList.contains('preview-btn') && data && !data.error && previewContentArea) { previewContentArea.innerHTML = generateLandingpageHtml(data); openPreviewModal(); }
        else if (btn.classList.contains('download-html-btn')) downloadHtml(idx);
    });

    function displayResult(data, index, container) {
        const card = document.createElement('div');
        card.style.cssText = 'background:rgba(255,255,255,0.02);padding:1.5rem;margin-bottom:1rem;border-left:3px solid ' + (data.intent === 'commercial' ? '#28a745' : 'var(--accent-color)') + ';';
        if (data.error) { card.innerHTML = '<h4 style="color:#ff6b6b;">' + data.keyword + '</h4><p style="color:#ff6b6b;">Fehler: ' + data.error + '</p>'; }
        else { card.innerHTML = '<h4 style="color:var(--text-color);margin:0 0 10px 0;">' + data.keyword + '</h4><p style="color:var(--text-color-muted);font-size:0.9rem;"><strong style="color:var(--accent-color);">Titel:</strong> ' + (data.post_title || 'N/A') + '</p><p style="color:var(--text-color-muted);font-size:0.9rem;"><strong style="color:var(--accent-color);">Meta:</strong> ' + (data.meta_description || 'N/A') + '</p><div style="margin-top:15px;display:flex;gap:10px;flex-wrap:wrap;"><button class="preview-btn cta-button" data-index="' + index + '" style="font-size:0.85rem;padding:0.6rem 1.2rem;"><i class="fas fa-eye"></i> Vorschau</button><button class="download-html-btn cta-button secondary" data-index="' + index + '" style="font-size:0.85rem;padding:0.6rem 1.2rem;"><i class="fas fa-file-code"></i> HTML</button></div>'; }
        container.appendChild(card);
    }

    // === HTML GENERATOR (FIX: JETZT MIT ALLEN FELDERN) ===
    function generateLandingpageHtml(data) {
        // Hilfsfunktion für FAQs
        let faqHtml = '';
        for(let i=1; i<=5; i++) {
            if(data['faq_'+i] && data['faq_answer_'+i]) {
                faqHtml += `<div style="margin-bottom:15px;"><strong>${data['faq_'+i]}</strong><p>${data['faq_answer_'+i]}</p></div>`;
            }
        }
        
        return `
        <div style="color:var(--text-color);line-height:1.7;padding:20px;">
            <header style="text-align:center;margin-bottom:40px;padding-bottom:30px;border-bottom:1px solid var(--border-color);">
                <h1 style="color:var(--accent-color);font-size:2rem;">${data.h1 || 'N/A'}</h1>
                <p style="color:var(--text-color-muted);font-size:1.1rem;">${data.hero_text || ''}</p>
                <p style="font-style:italic;">${data.hero_subtext || ''}</p>
                <button style="background:var(--accent-color);color:#000;border:none;padding:10px 20px;border-radius:5px;font-weight:bold;margin-top:10px;">${data.primary_cta || 'Click'}</button>
            </header>

            <section style="margin-bottom:40px;">
                <h3 style="border-bottom:2px solid var(--accent-color);display:inline-block;margin-bottom:15px;">Vorteile</h3>
                <p>${data.benefits_list_fließtext || ''}</p>
                ${data.benefits_list || ''}
            </section>

            <section style="margin-bottom:30px;padding:20px;background:rgba(255,255,255,0.02);border-left:3px solid var(--accent-color);">
                <h2 style="color:var(--accent-color);">${data.h2_1 || ''}</h2>
                <p>${data.h2_1_text || ''}</p>
            </section>

            <section style="margin-bottom:30px;padding:20px;background:rgba(255,255,255,0.02);border-left:3px solid #28a745;">
                <h2 style="color:#28a745;">${data.h2_2 || ''}</h2>
                <p>${data.h2_2_text || ''}</p>
            </section>

             <section style="margin-bottom:30px;">
                <h2 style="color:var(--accent-color);">${data.h2_3 || ''}</h2>
                <p>${data.h2_3_text || ''}</p>
            </section>

            <section style="margin-bottom:30px;">
                <h2 style="color:var(--accent-color);">${data.h2_4 || ''}</h2>
                <p>${data.h2_4_text || ''}</p>
            </section>

            <section style="margin-bottom:40px;">
                <h3 style="border-bottom:2px solid var(--accent-color);display:inline-block;margin-bottom:15px;">Features</h3>
                <p>${data.features_list_fließtext || ''}</p>
                ${data.features_list || ''}
            </section>

            <section style="background:rgba(255,255,255,0.03);padding:20px;margin-bottom:30px;border-radius:8px;">
                <h3 style="color:var(--accent-color);text-align:center;">Das sagen unsere Kunden</h3>
                <p style="text-align:center;font-style:italic;">"${data.social_proof || ''}"</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px;">
                    <div style="background:rgba(0,0,0,0.2);padding:15px;"><i>"${data.testimonial_1 || ''}"</i></div>
                    <div style="background:rgba(0,0,0,0.2);padding:15px;"><i>"${data.testimonial_2 || ''}"</i></div>
                </div>
            </section>

            <section style="margin-bottom:40px;">
                <h3 style="color:var(--accent-color);">Häufige Fragen (FAQ)</h3>
                ${faqHtml}
            </section>

            <section style="text-align:center;padding:30px;border:1px solid var(--border-color);margin-bottom:30px;">
                <h3>${data.guarantee_text || 'Zufriedenheitsgarantie'}</h3>
                <p>${data.trust_signals || ''}</p>
                <p><strong>Kontakt:</strong> ${data.contact_info || ''}</p>
                <button style="background:transparent;border:2px solid var(--accent-color);color:var(--accent-color);padding:10px 20px;border-radius:5px;font-weight:bold;margin-top:10px;">${data.secondary_cta || 'Mehr Infos'}</button>
            </section>

            <aside style="margin-top:30px;padding:20px;background:rgba(255,255,255,0.02);border:1px solid var(--border-color);font-size:0.9rem;">
                <h3 style="color:var(--accent-color);">SEO Meta-Daten</h3>
                <p><strong>URL-Slug:</strong> ${data.post_name || 'n-a'}</p>
                <p><strong>Meta Title:</strong> ${data.meta_title || 'N/A'}</p>
                <p><strong>Meta Description:</strong> ${data.meta_description || 'N/A'}</p>
            </aside>
        </div>`;
    }

    // === DOWNLOADS (FIX: ALLE FELDER HINZUGEFÜGT) ===
    const ALL_HEADERS = [
        "keyword","intent","post_title","post_name","meta_title","meta_description",
        "h1","hero_text","hero_subtext","primary_cta","secondary_cta",
        "h2_1","h2_1_text","h2_2","h2_2_text","h2_3","h2_3_text","h2_4","h2_4_text",
        "benefits_list_fließtext","benefits_list",
        "features_list_fließtext","features_list",
        "social_proof","testimonial_1","testimonial_2",
        "pricing_title","price_1","price_2","price_3",
        "faq_1","faq_answer_1","faq_2","faq_answer_2","faq_3","faq_answer_3","faq_4","faq_answer_4","faq_5","faq_answer_5",
        "contact_info","footer_cta","trust_signals","guarantee_text"
    ];

    function cleanForCsv(text) {
        if (text == null) return "";
        let str = String(text).replace(/[\u200B\u00AD\uFEFF\u2028\u2029]/g, '').replace(/\u00A0/g, ' ').replace(/(\r\n|\n|\r)/gm, ' ').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        return str.replace(/"/g, '""');
    }
    function downloadFile(content, fileName, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }
    function downloadHtml(index) {
        const data = allGeneratedData[index];
        if (!data || data.error) return alert('Keine Daten verfügbar.');
        const html = '<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>' + (data.meta_title || 'Landingpage') + '</title><style>:root{--bg-color:#0d0d0d;--text-color:#e8e8e8;--text-color-muted:#a0a0a0;--accent-color:#c4a35a;--border-color:rgba(255,255,255,0.1);}body{font-family:sans-serif;background:var(--bg-color);color:var(--text-color);margin:0;padding:20px;}ul{padding-left:20px;}</style></head><body>' + generateLandingpageHtml(data) + '</body></html>';
        downloadFile(html, (data.post_name || 'landingpage') + '.html', 'text/html;charset=utf-8;');
    }
    function downloadTxt() {
        let txt = '';
        allGeneratedData.forEach((row, i) => {
            if (row.error) return;
            txt += '='.repeat(50) + '\nINHALT FÜR: ' + row.keyword + '\n' + '='.repeat(50) + '\n\n';
            ALL_HEADERS.forEach(h => { const v = String(row[h] || '').replace(/<[^>]*>/g, ''); if (v) txt += h.toUpperCase() + ':\n' + v + '\n\n'; });
            if (i < allGeneratedData.length - 1) txt += '\n---\n\n';
        });
        downloadFile(txt, 'silas_content.txt', 'text/plain;charset=utf-8;');
    }
    function downloadCsv() {
        let csv = '\uFEFF' + ALL_HEADERS.join(',') + '\n';
        allGeneratedData.forEach(row => { 
            if (row.error) return; 
            csv += ALL_HEADERS.map(h => '"' + cleanForCsv(row[h]) + '"').join(',') + '\n'; 
        });
        downloadFile(csv, 'silas_content.csv', 'text/csv;charset=utf-8;');
    }

    // === INIT ===
    silasForm.addEventListener('submit', e => { e.preventDefault(); addKeywords(); });
    keywordInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addKeywords(); } });
    keywordDisplayList.addEventListener('click', e => { if (e.target.matches('.remove-btn')) { keywordList.splice(e.target.dataset.index, 1); updateKeywordDisplay(); } });
    clearListBtn.addEventListener('click', () => { keywordList = []; allGeneratedData = []; updateKeywordDisplay(); silasResponseContainer.innerHTML = ''; silasResponseContainer.style.display = 'none'; silasStatus.textContent = 'Bereit.'; });

    initDemoTracking();
    showDemoStatus();
    createMasterPasswordUI();
}
