// js/analytics-proxy.js
const Analytics = {
  // Generiert eine anonyme ID für den Browser (First-Party)
  getClientId() {
    let id = localStorage.getItem('designare_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('designare_id', id);
    }
    return id;
  },

  // Sendet das Event an deinen Vercel-Proxy
  async track(eventName, params = {}) {
    try {
      await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.getClientId(),
          events: [{
            name: eventName,
            params: {
              ...params,
              page_location: window.location.href,
              page_title: document.title
            }
          }]
        })
      });
    } catch (e) {
      console.warn('Analytics blocked or failed');
    }
  }
};

// Automatischer Page-View beim Laden
window.addEventListener('DOMContentLoaded', () => {
  Analytics.track('page_view');
});
