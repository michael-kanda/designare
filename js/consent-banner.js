// js/consent-banner.js – DSGVO-konformer Consent Mode v2
// Integriert sich in den bestehenden Cookie-Modal (cookie-info-lightbox)
// Google Consent Mode v2 (Basic Mode): gtag.js feuert erst NACH Zustimmung

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────

  const CONFIG = {
    GA_MEASUREMENT_ID: 'G-517088979', // ← HIER deine GA4 Measurement ID eintragen
    COOKIE_NAME: 'analytics_consent',
    COOKIE_DAYS: 365,
    PRIVACY_URL: '/datenschutz'
  };

  // ─────────────────────────────────────────────
  // CONSENT STATE (Cookie-basiert, kein localStorage)
  // ─────────────────────────────────────────────

  function getConsentChoice() {
    const match = document.cookie.match(new RegExp('(^| )' + CONFIG.COOKIE_NAME + '=([^;]+)'));
    return match ? match[2] : null;
  }

  function setConsentChoice(choice) {
    const expires = new Date(Date.now() + CONFIG.COOKIE_DAYS * 86400000).toUTCString();
    document.cookie = `${CONFIG.COOKIE_NAME}=${choice}; expires=${expires}; path=/; SameSite=Lax; Secure`;
  }

  // ─────────────────────────────────────────────
  // GOOGLE CONSENT MODE v2 – DEFAULTS
  // Muss VOR gtag.js ausgeführt werden
  // ─────────────────────────────────────────────

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };

  // Default: Alles verweigert (DSGVO Basic Mode)
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  // ─────────────────────────────────────────────
  // GTAG.JS LADEN (nur nach Consent)
  // ─────────────────────────────────────────────

  function loadGtag() {
    if (document.getElementById('gtag-script')) return;

    const script = document.createElement('script');
    script.id = 'gtag-script';
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${CONFIG.GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    script.onload = function () {
      gtag('js', new Date());
      gtag('config', CONFIG.GA_MEASUREMENT_ID, {
        anonymize_ip: true,
        send_page_view: true
      });
    };
  }

  function grantAnalyticsConsent() {
    gtag('consent', 'update', {
      analytics_storage: 'granted'
      // ad_storage, ad_user_data, ad_personalization bleiben 'denied'
    });
  }

  // ─────────────────────────────────────────────
  // BESTEHENDEN COOKIE-MODAL UMBAUEN
  // Ersetzt den reinen "Hinweis" durch echte Consent-Wahl
  // ─────────────────────────────────────────────

  function upgradeCookieModal() {
    const modal = document.getElementById('cookie-info-lightbox');
    if (!modal) return;

    // Text aktualisieren – klarer Hinweis auf Analytics
    const textEl = modal.querySelector('.cookie-info-text');
    if (textEl) {
      textEl.innerHTML = `
        Wir nutzen Google Analytics zur Verbesserung unserer Website.
        Technisch notwendige Cookies sind immer aktiv.
        Mehr in unserer <a href="${CONFIG.PRIVACY_URL}" style="color: #C4A35A; text-decoration: underline;">Datenschutzerklärung</a>.
      `;
    }

    // Buttons ersetzen: Akzeptieren + Ablehnen statt nur "Alles klar"
    const buttonContainer = modal.querySelector('.cookie-lightbox-buttons');
    if (buttonContainer) {
      buttonContainer.innerHTML = `
        <button id="consent-decline-btn" class="lightbox-button">Nur notwendige</button>
        <button id="consent-accept-btn" class="lightbox-button consent-accept-highlight">Alle akzeptieren</button>
      `;

      document.getElementById('consent-accept-btn').addEventListener('click', function () {
        setConsentChoice('granted');
        grantAnalyticsConsent();
        loadGtag();
        closeCookieModal(modal);
        localStorage.setItem('hasSeenCookieInfoLightbox', 'true');
      });

      document.getElementById('consent-decline-btn').addEventListener('click', function () {
        setConsentChoice('denied');
        closeCookieModal(modal);
        localStorage.setItem('hasSeenCookieInfoLightbox', 'true');
      });
    }

    // Alten "Alles klar" Button verstecken (falls modals.js ihn noch rendert)
    const oldBtn = document.getElementById('acknowledge-cookie-lightbox');
    if (oldBtn) oldBtn.style.display = 'none';

    // Alten Datenschutz-Link verstecken (ist jetzt im Text integriert)
    const oldLink = document.getElementById('privacy-policy-link-button');
    if (oldLink) oldLink.style.display = 'none';
  }

  function closeCookieModal(modal) {
    if (modal) {
      modal.classList.remove('visible');
      document.body.style.overflow = '';
      document.body.classList.remove('no-scroll');
    }
  }

  function showCookieModal() {
    const modal = document.getElementById('cookie-info-lightbox');
    if (modal) {
      modal.classList.add('visible');
      document.body.style.overflow = 'hidden';
      document.body.classList.add('no-scroll');
    }
  }

  // ─────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────

  function init() {
    const choice = getConsentChoice();

    if (choice === 'granted') {
      // Bereits zugestimmt → gtag sofort laden
      grantAnalyticsConsent();
      loadGtag();
    } else if (choice === 'denied') {
      // Abgelehnt → nichts laden, kein Banner
    } else {
      // Noch keine Entscheidung → Modal upgraden und anzeigen
      // Kurz warten damit modals.js den DOM aufgebaut hat
      setTimeout(() => {
        upgradeCookieModal();
        showCookieModal();
      }, 500);
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // Footer-Link: <a onclick="ConsentManager.showSettings()">Cookie-Einstellungen</a>
  // ─────────────────────────────────────────────

  window.ConsentManager = {
    /** Consent-Dialog erneut anzeigen */
    showSettings: function () {
      upgradeCookieModal();
      showCookieModal();
    },

    /** Consent widerrufen (DSGVO Art. 7 Abs. 3 – Recht auf Widerruf) */
    revokeConsent: function () {
      // FIX: Consent-State sofort auf denied setzen (stoppt laufendes Tracking)
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          analytics_storage: 'denied'
        });
      }

      // Consent-Cookie löschen
      document.cookie = `${CONFIG.COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;

      // GA-Cookies löschen (_ga, _gid und Varianten)
      document.cookie.split(';').forEach(function (c) {
        const name = c.trim().split('=')[0];
        if (name.startsWith('_ga') || name.startsWith('_gid')) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.' + window.location.hostname;
        }
      });

      // Proxy sessionStorage aufräumen
      try {
        sessionStorage.removeItem('_ap_cid');
        sessionStorage.removeItem('_ap_sid');
      } catch { /* ok */ }

      localStorage.removeItem('hasSeenCookieInfoLightbox');
      window.location.reload();
    },

    /** Status abfragen: 'granted' | 'denied' | 'pending' */
    getStatus: function () {
      return getConsentChoice() || 'pending';
    }
  };

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
