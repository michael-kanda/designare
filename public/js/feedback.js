// js/feedback.js
// Frontend Feedback-Funktionalität mit Vercel KV Backend
// + Schema.org AggregateRating Integration

(function() {
    'use strict';

    // === KONFIGURATION ===
    var API_ENDPOINT = '/api/feedback';
    
    // Slug aus URL generieren
    function getPageSlug() {
        return window.location.pathname
            .replace(/^\/|\/$/g, '')
            .replace(/\//g, '-')
            .replace(/\.html?$/, '')
            || 'home';
    }

    // === SCHEMA.ORG INTEGRATION ===
    function updateSchemaOrg(stats, total) {
        // Bei 0 Bewertungen nichts tun, um leere Schema-Einträge zu vermeiden
        if (!total || total === 0) return;
        
        // 1. Durchschnitt berechnen (positive=5, neutral=3, negative=1)
        var scoreSum = (stats.positive * 5) + (stats.neutral * 4) + (stats.negative * 2);
        var average = (scoreSum / total).toFixed(1);
        
        // Das Rating-Objekt
        var aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": average,
            "bestRating": "5",
            "worstRating": "1",
            "ratingCount": total.toString()
        };
        
        // 2. Suche das existierende JSON-LD Script im Head
        var scripts = document.querySelectorAll('script[type="application/ld+json"]');
        var updated = false;
        
        scripts.forEach(function(script) {
            if (updated) return; // Wenn schon gefunden, abbrechen
            
            try {
                var json = JSON.parse(script.textContent);
                
                // Prüfen ob es dein Haupt-Artikel-Schema ist
                if (json['@type'] === 'BlogPosting' || json['@type'] === 'Article' || json['@type'] === 'NewsArticle') {
                    
                    // Rating hinzufügen oder überschreiben
                    json.aggregateRating = aggregateRating;
                    
                    // Zurück in den Tag schreiben
                    script.textContent = JSON.stringify(json, null, 2);
                    updated = true;
                    console.log('🌟 Existierendes Schema.org erweitert:', average, 'Sterne bei', total, 'Bewertungen');
                }
            } catch (e) {
                // Fehler beim Parsen ignorieren (falls mal ungültiges JSON drin ist)
            }
        });
        
        // 3. Fallback: Wenn KEIN passendes Script gefunden wurde, erstellen wir ein neues
        if (!updated) {
            var scriptId = 'json-ld-feedback-rating-fallback';
            var newScript = document.getElementById(scriptId);
            
            if (!newScript) {
                newScript = document.createElement('script');
                newScript.id = scriptId;
                newScript.type = 'application/ld+json';
                document.head.appendChild(newScript);
            }
            
            var fallbackData = {
                "@context": "https://schema.org/",
                "@type": "Article",
                "headline": document.title,
                "url": window.location.href,
                "aggregateRating": aggregateRating
            };
            
            newScript.textContent = JSON.stringify(fallbackData);
            console.log('🌟 Neues Schema.org Element erstellt (Fallback):', average, 'Sterne');
        }
    }

    // === INITIALISIERUNG ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }

    // MutationObserver für dynamisch geladenen Content
    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length) {
                tryInit();
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    window.initFeedbackSection = tryInit;

    // === HAUPTFUNKTION ===
    function tryInit() {
        var feedbackSection = document.querySelector('.feedback-section');
        if (!feedbackSection) return;
        
        if (feedbackSection.dataset.initialized === 'true') return;
        feedbackSection.dataset.initialized = 'true';
        
        console.log('✅ Feedback-Sektion initialisiert');
        
        loadStats(feedbackSection);
        initRatingButtons(feedbackSection);
        initShareButtons(feedbackSection);
        
        observer.disconnect();
    }

    // === STATISTIKEN LADEN ===
    function loadStats(container) {
        var slug = getPageSlug();
        
        fetch(API_ENDPOINT + '?slug=' + encodeURIComponent(slug))
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('API Fehler: ' + response.status);
                }
                return response.json();
            })
            .then(function(data) {
                if (data.success) {
                    updateRatioBar(container, data.percentages, data.total);
                    
                    // Schema.org Update aufrufen
                    updateSchemaOrg(data.stats, data.total);
                    
                    console.log('📊 Statistiken geladen:', data);
                }
            })
            .catch(function(error) {
                console.warn('⚠️ Statistiken konnten nicht geladen werden:', error);
                hideRatioBar(container);
            });
    }

    // === RATIO BAR AKTUALISIEREN ===
    function updateRatioBar(container, percentages, total) {
        var posBar = container.querySelector('.ratio-segment.pos');
        var neuBar = container.querySelector('.ratio-segment.neu');
        var negBar = container.querySelector('.ratio-segment.neg');
        var labels = container.querySelector('.rating-labels');
        
        if (posBar) posBar.style.width = percentages.positive + '%';
        if (neuBar) neuBar.style.width = percentages.neutral + '%';
        if (negBar) negBar.style.width = percentages.negative + '%';
        
        if (labels) {
            if (total > 0) {
                labels.innerHTML = 
                    '<span>👍 ' + percentages.positive + '% hilfreich</span>' +
                    '<span>' + total + ' Bewertung' + (total !== 1 ? 'en' : '') + '</span>';
            } else {
                labels.innerHTML = 
                    '<span>Noch keine Bewertungen</span>' +
                    '<span>Sei der Erste!</span>';
            }
        }
    }

    // === RATIO BAR AUSBLENDEN ===
    function hideRatioBar(container) {
        var ratioBar = container.querySelector('.rating-ratio-bar');
        var labels = container.querySelector('.rating-labels');
        
        if (ratioBar) ratioBar.style.display = 'none';
        if (labels) labels.style.display = 'none';
    }

    // === RATING BUTTONS ===
    function initRatingButtons(container) {
        var ratingButtons = container.querySelectorAll('.rating-btn');
        if (ratingButtons.length === 0) return;

        var localStorageKey = 'feedback_' + getPageSlug();
        
        var existingVote = localStorage.getItem(localStorageKey);
        if (existingVote) {
            markVotedState(container, existingVote);
        }

        ratingButtons.forEach(function(btn) {
            if (btn.dataset.listenerAdded === 'true') return;
            btn.dataset.listenerAdded = 'true';
            
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                if (localStorage.getItem(localStorageKey)) {
                    showFeedbackMessage(container, 'Du hast bereits abgestimmt. Danke!', 'info');
                    return;
                }

                var voteType = btn.dataset.vote || 'neutral';
                if (btn.classList.contains('positive')) voteType = 'positive';
                if (btn.classList.contains('negative')) voteType = 'negative';

                btn.disabled = true;
                var originalText = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Wird gespeichert...';

                fetch(API_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        slug: getPageSlug(),
                        vote: voteType
                    })
                })
                .then(function(response) {
                    return response.json();
                })
                .then(function(data) {
                    if (data.success) {
                        localStorage.setItem(localStorageKey, voteType);
                        btn.innerHTML = originalText;
                        markVotedState(container, voteType);
                        updateRatioBar(container, data.percentages, data.total);
                        
                        // Schema.org Update nach Abstimmung
                        updateSchemaOrg(data.stats, data.total);
                        
                        showFeedbackMessage(container, 'Danke für dein Feedback!', 'success');
                        
                        console.log('✅ Vote gespeichert:', voteType);
                        
                        if (typeof gtag === 'function') {
                            gtag('event', 'feedback_vote', {
                                'event_category': 'engagement',
                                'event_label': voteType
                            });
                        }
                    } else {
                        throw new Error(data.error || 'Unbekannter Fehler');
                    }
                })
                .catch(function(error) {
                    console.error('❌ Fehler beim Speichern:', error);
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                    showFeedbackMessage(container, 'Fehler beim Speichern. Bitte versuche es erneut.', 'error');
                });
            });
        });
        
        console.log('✅ ' + ratingButtons.length + ' Rating-Buttons initialisiert');
    }

    function markVotedState(container, voteType) {
        var buttons = container.querySelectorAll('.rating-btn');
        
        buttons.forEach(function(btn) {
            btn.disabled = true;
            btn.style.cursor = 'default';
            btn.style.opacity = '0.4';
            btn.style.transform = 'none';
            
            var isSelected = btn.classList.contains(voteType) || btn.dataset.vote === voteType;
            
            if (isSelected) {
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1.05)';
                
                if (voteType === 'positive') {
                    btn.style.backgroundColor = 'rgba(81, 207, 102, 0.15)';
                    btn.style.borderColor = '#51cf66';
                    btn.style.color = '#51cf66';
                    btn.style.boxShadow = '0 4px 20px rgba(81, 207, 102, 0.25)';
                } else if (voteType === 'negative') {
                    btn.style.backgroundColor = 'rgba(255, 107, 107, 0.15)';
                    btn.style.borderColor = '#ff6b6b';
                    btn.style.color = '#ff6b6b';
                    btn.style.boxShadow = '0 4px 20px rgba(255, 107, 107, 0.25)';
                } else {
                    btn.style.backgroundColor = 'rgba(252, 181, 0, 0.15)';
                    btn.style.borderColor = '#FCB500';
                    btn.style.color = '#FCB500';
                    btn.style.boxShadow = '0 4px 20px rgba(252, 181, 0, 0.25)';
                }
            }
        });
    }

    function showFeedbackMessage(container, message, type) {
        var existingMsg = container.querySelector('.feedback-message');
        if (existingMsg) existingMsg.remove();

        var msgDiv = document.createElement('div');
        msgDiv.className = 'feedback-message feedback-' + type;
        msgDiv.textContent = message;
        msgDiv.style.cssText = 
            'text-align: center;' +
            'padding: 12px 18px;' +
            'margin: 15px auto;' +
            'border-radius: 10px;' +
            'font-size: 0.9rem;' +
            'max-width: 400px;' +
            'animation: feedbackFadeIn 0.3s ease;';
        
        if (type === 'success') {
            msgDiv.style.background = 'rgba(81, 207, 102, 0.1)';
            msgDiv.style.color = '#51cf66';
            msgDiv.style.border = '1px solid rgba(81, 207, 102, 0.25)';
        } else if (type === 'info') {
            msgDiv.style.background = 'rgba(252, 181, 0, 0.1)';
            msgDiv.style.color = '#FCB500';
            msgDiv.style.border = '1px solid rgba(252, 181, 0, 0.25)';
        } else if (type === 'error') {
            msgDiv.style.background = 'rgba(255, 107, 107, 0.1)';
            msgDiv.style.color = '#ff6b6b';
            msgDiv.style.border = '1px solid rgba(255, 107, 107, 0.25)';
        }

        var ratioBar = container.querySelector('.rating-ratio-bar');
        var feedbackContainer = container.querySelector('.feedback-container');
        
        if (ratioBar && ratioBar.parentNode) {
            ratioBar.parentNode.insertBefore(msgDiv, ratioBar);
        } else if (feedbackContainer) {
            feedbackContainer.appendChild(msgDiv);
        } else {
            container.appendChild(msgDiv);
        }

        setTimeout(function() {
            msgDiv.style.opacity = '0';
            msgDiv.style.transition = 'opacity 0.3s ease';
            setTimeout(function() {
                if (msgDiv.parentNode) msgDiv.remove();
            }, 300);
        }, 3000);
    }

    // === SHARE BUTTONS ===
    function initShareButtons(container) {
        var shareLinks = container.querySelectorAll('.share-icon');
        if (shareLinks.length === 0) return;

        var pageUrl = encodeURIComponent(window.location.href);
        var pageTitle = encodeURIComponent(document.title);

        shareLinks.forEach(function(link) {
            if (link.dataset.listenerAdded === 'true') return;
            link.dataset.listenerAdded = 'true';
            
            link.style.cursor = 'pointer';
            
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();

                var shareUrl = '';
                var platform = link.dataset.platform;
                
                if (!platform) {
                    var icon = link.querySelector('i');
                    if (icon) {
                        if (icon.classList.contains('fa-whatsapp')) platform = 'whatsapp';
                        else if (icon.classList.contains('fa-linkedin-in')) platform = 'linkedin';
                        else if (icon.classList.contains('fa-reddit-alien')) platform = 'reddit';
                        else if (icon.classList.contains('fa-x-twitter')) platform = 'twitter';
                        else if (icon.classList.contains('fa-link')) platform = 'copy';
                    }
                }

                switch (platform) {
                    case 'whatsapp':
                        shareUrl = 'https://wa.me/?text=' + pageTitle + '%20' + pageUrl;
                        break;
                    case 'linkedin':
                        shareUrl = 'https://www.linkedin.com/sharing/share-offsite/?url=' + pageUrl;
                        break;
                    case 'reddit':
                        shareUrl = 'https://www.reddit.com/submit?url=' + pageUrl + '&title=' + pageTitle;
                        break;
                    case 'twitter':
                        shareUrl = 'https://twitter.com/intent/tweet?url=' + pageUrl + '&text=' + pageTitle;
                        break;
                    case 'copy':
                        copyToClipboard(window.location.href, link);
                        return;
                    default:
                        return;
                }

                if (shareUrl) {
                    window.open(shareUrl, '_blank', 'width=600,height=500,menubar=no,toolbar=no,scrollbars=yes');
                    
                    if (typeof gtag === 'function') {
                        gtag('event', 'share', {
                            'event_category': 'engagement',
                            'event_label': platform
                        });
                    }
                }
            });
        });
        
        console.log('✅ ' + shareLinks.length + ' Share-Buttons initialisiert');
    }

    // === COPY TO CLIPBOARD ===
    function copyToClipboard(text, element) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                showCopyTooltip(element, 'Link kopiert!');
            }).catch(function() {
                fallbackCopy(text, element);
            });
        } else {
            fallbackCopy(text, element);
        }
    }

    function fallbackCopy(text, element) {
        var textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
            showCopyTooltip(element, 'Link kopiert!');
        } catch (err) {
            showCopyTooltip(element, 'Fehler beim Kopieren');
        }

        document.body.removeChild(textArea);
    }

    function showCopyTooltip(element, message) {
        var existingTooltip = document.querySelector('.copy-tooltip');
        if (existingTooltip) existingTooltip.remove();

        var tooltip = document.createElement('span');
        tooltip.className = 'copy-tooltip';
        tooltip.textContent = message;
        tooltip.style.cssText = 
            'position: absolute;' +
            'background: #FCB500;' +
            'color: #000;' +
            'padding: 6px 12px;' +
            'border-radius: 6px;' +
            'font-size: 0.75rem;' +
            'font-weight: 500;' +
            'white-space: nowrap;' +
            'z-index: 1000;' +
            'left: 50%;' +
            'bottom: 100%;' +
            'transform: translateX(-50%);' +
            'margin-bottom: 8px;';

        var computedStyle = window.getComputedStyle(element);
        if (computedStyle.position === 'static') {
            element.style.position = 'relative';
        }
        
        element.appendChild(tooltip);

        setTimeout(function() {
            tooltip.style.opacity = '0';
            tooltip.style.transition = 'opacity 0.2s ease';
            setTimeout(function() {
                if (tooltip.parentNode) tooltip.remove();
            }, 200);
        }, 2000);
    }

    // === CSS ANIMATIONEN ===
    var style = document.createElement('style');
    style.textContent = 
        '@keyframes feedbackFadeIn {' +
        '  from { opacity: 0; transform: translateY(-10px); }' +
        '  to { opacity: 1; transform: translateY(0); }' +
        '}';
    document.head.appendChild(style);

})();
