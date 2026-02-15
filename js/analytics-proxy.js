// js/analytics-proxy.js – Version 3.2 (Hybrid)
// Cookieless Custom Event Tracking via Measurement Protocol
//
// Standard-Metriken (Nutzer, Traffic, Device) → gtag.js (mit Consent)
// Custom Events (Scroll, Clicks, Conversions) → dieser Proxy (ohne Cookies)
//
// DSGVO: Kein localStorage, keine Cookies, keine persistenten IDs.
// Jeder Pageload erzeugt eine neue anonyme Session.

const Analytics = {
  startTime: Date.now(),
  scrollMilestones: [25, 50, 75, 90],
  scrollTracked: new Set(),
  maxScrollDepth: 0,
  isEngaged: false,
  debugMode: false,

  // Anonyme IDs – nur im RAM, werden bei Pageload neu erzeugt
  _sessionId: null,
  _clientId: null,

  // ─────────────────────────────────────────────
  // ANONYMOUS IDs (kein Cookie, kein localStorage)
  // ─────────────────────────────────────────────

  getClientId() {
    if (!this._clientId) {
      const ts = Math.floor(Date.now() / 1000);
      const rnd = Math.floor(Math.random() * 1000000000);
      this._clientId = `${ts}.${rnd}`;
    }
    return this._clientId;
  },

  getSessionId() {
    if (!this._sessionId) {
      this._sessionId = Math.floor(Date.now() / 1000);
    }
    return this._sessionId;
  },

  getEngagementTime() {
    return Math.max(100, Date.now() - this.startTime);
  },

  // ─────────────────────────────────────────────
  // TRACKING (cookieless via Proxy)
  // ─────────────────────────────────────────────

  async track(eventName, customParams = {}) {
    try {
      const payload = {
        client_id: this.getClientId(),
        events: [{
          name: eventName,
          params: {
            ga_session_id: this.getSessionId(),
            ga_session_number: 1,
            engagement_time_msec: this.getEngagementTime(),
            page_location: window.location.href,
            page_title: document.title,
            page_path: window.location.pathname,
            ...customParams
          }
        }]
      };

      await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });

      if (this.debugMode) {
        console.log(`📊 [Proxy] ${eventName}`, customParams);
      }
    } catch (err) {
      if (this.debugMode) console.warn('Analytics proxy error:', err.message);
    }
  },

  trackBeacon(eventName, customParams = {}) {
    try {
      const payload = {
        client_id: this.getClientId(),
        events: [{
          name: eventName,
          params: {
            ga_session_id: this.getSessionId(),
            ga_session_number: 1,
            engagement_time_msec: this.getEngagementTime(),
            page_location: window.location.href,
            page_title: document.title,
            ...customParams
          }
        }]
      };
      navigator.sendBeacon('/api/metrics', JSON.stringify(payload));
    } catch (err) {
      if (this.debugMode) console.warn('Beacon error:', err.message);
    }
  },

  // ─────────────────────────────────────────────
  // SCROLL TRACKING
  // ─────────────────────────────────────────────

  getScrollPercentage() {
    const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const viewH = window.innerHeight;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    if (docH <= viewH) return 100;
    return Math.round((scrollTop / (docH - viewH)) * 100);
  },

  checkScrollMilestones() {
    const pct = this.getScrollPercentage();
    if (pct > this.maxScrollDepth) this.maxScrollDepth = pct;

    for (const m of this.scrollMilestones) {
      if (pct >= m && !this.scrollTracked.has(m)) {
        this.scrollTracked.add(m);
        this.track('scroll_depth', { percent_scrolled: m });
        if (m >= 50) this.isEngaged = true;
      }
    }
  },

  // ─────────────────────────────────────────────
  // EXIT EVENT
  // ─────────────────────────────────────────────

  sendExitEvent() {
    this.trackBeacon('page_exit', {
      time_on_page_sec: Math.round((Date.now() - this.startTime) / 1000),
      max_scroll_depth: this.maxScrollDepth,
      was_engaged: this.isEngaged
    });
  },

  // ─────────────────────────────────────────────
  // CONVERSIONS (Proxy + gtag.js wenn Consent)
  // ─────────────────────────────────────────────

  hasConsent() {
    const match = document.cookie.match(/(^| )analytics_consent=([^;]+)/);
    return match && match[2] === 'granted';
  },

  trackConversion(type, value = null, currency = 'EUR') {
    const params = { conversion_type: type };
    if (value !== null) { params.value = value; params.currency = currency; }
    this.track('conversion', params);

    // Auch an gtag senden wenn Consent vorhanden
    if (this.hasConsent() && typeof gtag === 'function') {
      gtag('event', 'generate_lead', { event_category: 'conversion', event_label: type, value: value });
    }
  },

  // ─────────────────────────────────────────────
  // CLICK HANDLER
  // ─────────────────────────────────────────────

  handleClick(event) {
    const target = event.target;

    // Buttons
    const button = target.closest('button, [role="button"], .btn');
    if (button) {
      const text = (button.innerText || button.value || '').trim().substring(0, 100);
      const id = button.id || button.name || button.className?.split(' ')[0] || 'unknown';
      const ctaWords = ['anfragen', 'kontakt', 'buchen', 'kaufen', 'bestellen', 'senden', 'submit', 'absenden'];
      const isCta = ctaWords.some(kw => text.toLowerCase().includes(kw));

      this.track('cta_click', { button_text: text, button_id: id, is_conversion_cta: isCta });
      if (isCta) this.trackConversion('cta_click');
      this.isEngaged = true;
      return;
    }

    // Links
    const link = target.closest('a');
    if (!link || !link.href) return;
    const url = link.href;
    const linkText = (link.innerText || link.title || '').trim().substring(0, 100);

    // Downloads
    if (/\.(pdf|zip|docx?|xlsx?|pptx?|mp3|mp4|csv|rar)$/i.test(url)) {
      const name = url.split('/').pop() || 'unknown';
      this.track('file_download', { file_name: name, file_extension: name.split('.').pop()?.toLowerCase(), link_text: linkText });
      this.isEngaged = true;
      return;
    }

    // mailto / tel
    if (url.startsWith('mailto:')) {
      this.track('contact_click', { method: 'email', contact_info: url.replace('mailto:', '').split('?')[0] });
      this.trackConversion('contact_email');
      this.isEngaged = true;
      return;
    }
    if (url.startsWith('tel:')) {
      this.track('contact_click', { method: 'phone', contact_info: url.replace('tel:', '') });
      this.trackConversion('contact_phone');
      this.isEngaged = true;
      return;
    }

    // Outbound
    try {
      const host = new URL(url).hostname;
      if (host && host !== window.location.hostname) {
        this.track('outbound_click', { link_url: url, link_domain: host, link_text: linkText });
      }
    } catch { /* ignore */ }
  },

  handleFormSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    this.track('form_submit', { form_id: form.id || form.name || 'unknown_form' });
    this.trackConversion('form_submission');
    this.isEngaged = true;
  },

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────

  init() {
    if (window.__analyticsProxyInit) return;
    window.__analyticsProxyInit = true;

    // Scroll (throttled)
    let st = null;
    window.addEventListener('scroll', () => {
      if (st) return;
      st = setTimeout(() => { this.checkScrollMilestones(); st = null; }, 250);
    }, { passive: true });

    // Exit
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.sendExitEvent();
    });
    window.addEventListener('pagehide', () => this.sendExitEvent());

    // Clicks & Forms
    document.addEventListener('click', (e) => this.handleClick(e), { capture: true });
    document.addEventListener('submit', (e) => this.handleFormSubmit(e), { capture: true });

    if (this.debugMode) console.log('📊 Analytics Proxy v3.2 (cookieless) initialized');
  },

  // Public
  enableDebug() { this.debugMode = true; console.log('📊 Proxy debug ON'); },
  disableDebug() { this.debugMode = false; },
  event(name, params = {}) { return this.track(name, params); }
};

// AUTO-START
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Analytics.init());
} else {
  Analytics.init();
}

window.Analytics = Analytics;
