// api/utils.js
function analyzeKeywordContext(keyword) {
    const lowerKeyword = keyword.toLowerCase();
    
    if (lowerKeyword.includes('software') || lowerKeyword.includes('app') || lowerKeyword.includes('web') || lowerKeyword.includes('digital')) {
        return {
            name: 'tech',
            audience: 'Entwickler und IT-Entscheider',
            problems: 'Komplexität und Integration',
            solutions: 'Effizienz und Automatisierung'
        };
    }
    
    if (lowerKeyword.includes('marketing') || lowerKeyword.includes('seo') || lowerKeyword.includes('beratung')) {
        return {
            name: 'business', 
            audience: 'Unternehmer und Marketing-Manager',
            problems: 'Zeitmanagement und ROI-Unsicherheit',
            solutions: 'Wachstum und Wettbewerbsvorteil'
        };
    }
    
    return {
        name: 'general',
        audience: 'Interessenten',
        problems: 'Verschiedene Herausforderungen', 
        solutions: 'Qualität und Service'
    };
}

function buildBetterPrompt(keyword, intent, context) {
    return `Du bist ein SEO-Content-Experte. Erstelle Content für "${keyword}".

ZIELGRUPPE: ${context.audience}
INTENT: ${intent}

VERMEIDE unbedingt diese Standard-Floskeln:
- "jahrelange Erfahrung"
- "professionell und zuverlässig" 
- "Ihr vertrauensvoller Partner"

NUTZE stattdessen spezifische ${keyword}-Aussagen.

Antwort als valides JSON:
{
  "post_title": "SEO-Titel mit ${keyword} (50-60 Zeichen)",
  "meta_description": "Meta-Text mit ${keyword} (150-160 Zeichen)",
  "h1": "H1 mit ${keyword} + Hauptnutzen",
  "hero_text": "Hero-Text (70-90 Wörter) für ${context.audience}",
  "benefits_list": "HTML-Liste mit 5 ${keyword}-Vorteilen",
  "primary_cta": "Call-to-Action für ${keyword}"
}`;
}

module.exports = { analyzeKeywordContext, buildBetterPrompt };
