// api/fact-checker.js - FINALE VERSION (Mit Lektorat-Modus & Rechtschreibprüfung)
export class FactChecker {
    constructor() {
        // 1. Problematische Phrasen für den E-E-A-T Check
        this.problematicPhrases = {
            'garantiert': { severity: 'high' },
            '100%': { severity: 'high' },
            'immer': { severity: 'medium' },
            'nie': { severity: 'medium' },
            'nummer 1': { severity: 'high' },
            'marktführer': { severity: 'high' },
            'beste': { severity: 'medium' },
            'revolutionär': { severity: 'medium' },
            'einzigartig': { severity: 'low' }
        };

        // 2. Definition der Mustertexte (Templates)
        this.templates = {
            service: {
                description: "Beispiel für eine Dienstleistung/Agentur (Fokus: Vertrauen & Expertise)",
                json: `{
                  "post_title": "SEO & GEO Agentur",
                  "post_name": "seo-geo-agentur",
                  "meta_title": "SEO & GEO Agentur ➤ Sichtbarkeit in Google & KI steigern",
                  "meta_description": "Platz 1 in Google & KI mit professioneller SEO & GEO Optimierung. ✓ 500+ Projekte ✓ Nachhaltiges Wachstum. Jetzt Erstgespräch sichern!",
                  "h1": "SEO Agentur: Mehr Sichtbarkeit auf Google und in KI",
                  "h2_1": "Warum klassisches SEO heute nicht mehr reicht",
                  "h2_1_text": "Früher reichte es, Keywords zu optimieren. Heute suchen Menschen via ChatGPT und Perplexity. Als moderne Agentur verbinden wir technisches SEO mit GEO (Generative Engine Optimization), damit deine Marke überall dort stattfindet, wo deine Kunden suchen.",
                  "h2_2": "Mehr Sichtbarkeit in Suchmaschinen und KI sichern",
                  "h2_2_text": "Professionelle Suchmaschinenoptimierung (SEO) bringt deine Website nachhaltig auf Top-Positionen. Gleichzeitig sorgt GEO dafür, dass deine Inhalte auch in KI-Antworten präsent sind.",
                  "h2_3": "Mehr Reichweite bedeutet mehr Umsatz",
                  "h2_3_text": "Gezielte Strategien steigern deine Online-Sichtbarkeit. Wir vereinen SEO mit Conversion-Optimierung, damit aus Besuchern auch zahlende Kunden werden.",
                  "h2_4": "Nachhaltiges Wachstum statt teurer Werbung",
                  "h2_4_text": "Organische Sichtbarkeit wirkt dauerhaft. Studien zeigen, dass SEO langfristig einen höheren ROI bietet als kurzfristige Anzeigenkampagnen.",
                  "primary_cta": "Kostenloses Audit anfordern",
                  "secondary_cta": "Mehr erfahren",
                  "hero_text": "Digitale Sichtbarkeit entscheidet über deinen Markterfolg. Wir sorgen dafür, dass dein Unternehmen nicht nur gefunden, sondern als erste Wahl von KI-Systemen empfohlen wird.",
                  "hero_subtext": "Wir setzen uns für deinen nachhaltigen digitalen Erfolg ein",
                  "benefits_list": "<ul><li>Maximale Sichtbarkeit in Google & KI-Systemen.</li><li>Nachhaltige Lead-Generierung ohne teure Ads.</li><li>Höhere Markenautorität durch Experten-Content.</li><li>Individuelle Strategien für deine Zielgruppe.</li><li>Transparente Reportings und Analysen.</li></ul>",
                  "benefits_list_fließtext": "Profitiere von einer ganzheitlichen Strategie, die technische Exzellenz mit hochwertigem Content verbindet, um deine Marktposition dauerhaft zu stärken.",
                  "features_list": "<ul><li>Umfassendes SEO-Audit & Keyword-Analyse.</li><li>Technische OnPage-Optimierung.</li><li>Content-Erstellung für Mensch & KI.</li><li>High-Quality Backlink-Aufbau.</li><li>Monatliche Performance-Calls.</li></ul>",
                  "features_list_fließtext": "Unser Leistungsspektrum deckt alle Bereiche moderner Suchmaschinenoptimierung ab – von der technischen Basis bis zur inhaltlichen Kür.",
                  "social_proof": "Über 150 Unternehmen vertrauen bereits auf unsere Expertise.",
                  "testimonial_1": "Seit wir mit der Agentur zusammenarbeiten, haben sich unsere Anfragen verdoppelt. Absolute Empfehlung! - Sarah M., Marketing Managerin",
                  "testimonial_2": "Endlich eine Agentur, die nicht nur verspricht, sondern liefert. Die Reportings sind transparent und die Ergebnisse sprechen für sich. - Tom K., Geschäftsführer",
                  "pricing_title": "Unsere Pakete",
                  "price_1": "<strong>Starter</strong><br />Ideal für lokale Unternehmen.<br />✅ SEO-Grundlagen<br />✅ Google Maps Optimierung<br /><strong>ab 990 €</strong>",
                  "price_2": "<strong>Business</strong><br />Für ambitionierte Wachstumsziele.<br />✅ Nationale SEO-Strategie<br />✅ Content-Flatrate<br /><strong>ab 1.990 €</strong>",
                  "price_3": "<strong>Enterprise</strong><br />Maximale Dominanz in deiner Nische.<br />✅ Full-Service Betreuung<br />✅ KI-Integration<br /><strong>auf Anfrage</strong>",
                  "faq_1": "Wie lange dauert es, bis SEO wirkt?",
                  "faq_answer_1": "SEO ist ein Marathon, kein Sprint. Erste Ergebnisse sieht man oft nach 3-6 Monaten, die volle Wirkung entfaltet sich langfristig.",
                  "faq_2": "Muss ich einen laufenden Vertrag abschließen?",
                  "faq_answer_2": "Wir bieten sowohl Projektarbeiten als auch laufende Betreuung an. Für nachhaltigen Erfolg empfehlen wir jedoch eine kontinuierliche Zusammenarbeit.",
                  "faq_3": "Was ist der Unterschied zu Google Ads?",
                  "faq_answer_3": "Bei Ads zahlst du für jeden Klick. Sobald das Budget leer ist, bist du unsichtbar. SEO baut organische, kostenlose Besucherströme auf, die dauerhaft bleiben.",
                  "faq_4": "Optimiert ihr auch für KI-Suchmaschinen?",
                  "faq_answer_4": "Ja, wir sind spezialisiert auf GEO (Generative Engine Optimization), um deine Marke auch in ChatGPT, Bing Chat und Co. sichtbar zu machen.",
                  "faq_5": "Bekomme ich einen festen Ansprechpartner?",
                  "faq_answer_5": "Absolut. Du hast einen persönlichen Strategen an deiner Seite, der dein Projekt von A bis Z kennt.",
                  "contact_info": "Lass uns über dein Projekt sprechen. Buche jetzt dein unverbindliches Erstgespräch.",
                  "footer_cta": "Termin vereinbaren",
                  "trust_signals": "TÜV-zertifizierte Prozesse | Google Partner | 100% Transparent",
                  "guarantee_text": "Wir garantieren transparente Arbeit und messbare Fortschritte."
                }`
            },
            product: {
                description: "Beispiel für ein physisches Produkt/Shop (Fokus: Features & Kaufanreiz)",
                json: `{
                  "post_title": "Ergonomischer Bürostuhl 'BackHero Pro'",
                  "post_name": "backhero-pro-ergonomischer-buerostuhl",
                  "meta_title": "BackHero Pro ➤ Der ergonomische Bürostuhl gegen Rückenschmerzen",
                  "meta_description": "Schmerzfrei sitzen mit dem BackHero Pro. ✓ Lordosenstütze ✓ Atmungsaktives Mesh ✓ 30 Tage Probewohnen. Bestelle jetzt versandkostenfrei!",
                  "h1": "BackHero Pro: Endlich schmerzfrei am Schreibtisch arbeiten",
                  "h2_1": "Revolutionäre Ergonomie für deinen Rücken",
                  "h2_1_text": "Der BackHero Pro passt sich deiner Wirbelsäule automatisch an. Dank der patentierten 'Dynamic-Spine'-Technologie wird dein unterer Rücken bei jeder Bewegung optimal gestützt, was Verspannungen aktiv vorbeugt.",
                  "h2_2": "Atmungsaktivität für lange Arbeitstage",
                  "h2_2_text": "Kein Schwitzen mehr im Sommer. Das spezielle High-Tech Mesh-Gewebe sorgt für eine optimale Luftzirkulation und hält dich auch bei langen Meetings angenehm kühl.",
                  "h2_3": "Perfekte Anpassung an deinen Körper",
                  "h2_3_text": "Jeder Mensch ist anders. Deshalb lässt sich der BackHero Pro in 12 Punkten individuell einstellen – von der Sitztiefe bis zur Neigung der Kopfstütze.",
                  "h2_4": "Langlebigkeit trifft auf Design",
                  "h2_4_text": "Wir verwenden nur hochwertige Materialien wie Flugzeug-Aluminium und abriebfesten Stoff. Das moderne, minimalistische Design wertet jedes Home-Office optisch auf.",
                  "primary_cta": "In den Warenkorb legen",
                  "secondary_cta": "Alle Features ansehen",
                  "hero_text": "Vergiss Rückenschmerzen nach langen Arbeitstagen. Der BackHero Pro kombiniert medizinisches Wissen mit modernem Design, um dir den besten Sitzkomfort deines Lebens zu bieten.",
                  "hero_subtext": "Investiere in deine Gesundheit und Produktivität.",
                  "benefits_list": "<ul><li>Aktive Unterstützung der Lendenwirbelsäule.</li><li>Atmungsaktives Mesh-Material gegen Schwitzen.</li><li>Vollständig verstellbare 4D-Armlehnen.</li><li>Fördert eine gesunde, aufrechte Sitzhaltung.</li><li>Einfacher Aufbau in unter 10 Minuten.</li></ul>",
                  "benefits_list_fließtext": "Der BackHero Pro ist mehr als nur ein Stuhl – er ist dein täglicher Begleiter für gesundes und produktives Arbeiten ohne Schmerzen.",
                  "features_list": "<ul><li>Patentierte Dynamic-Spine Lordosenstütze.</li><li>Belastbar bis 150kg.</li><li>Synchronmechanik mit Gewichtsregulierung.</li><li>Weiche Rollen für Hartböden.</li><li>5 Jahre Herstellergarantie.</li></ul>",
                  "features_list_fließtext": "Ausgestattet mit Premium-Komponenten, die normalerweise nur in Stühlen der 1000€+ Klasse zu finden sind.",
                  "social_proof": "Testsieger im 'Büro Magazin' 2024 & über 10.000 zufriedene Kunden.",
                  "testimonial_1": "Mein Rückenweh war nach einer Woche weg. Ich will nie wieder auf einem anderen Stuhl sitzen! - Michael B., Programmierer",
                  "testimonial_2": "Top Qualität, super schneller Aufbau und der Sitzkomfort ist ein Traum. Klare Kaufempfehlung. - Julia S., Architektin",
                  "pricing_title": "Wähle deine Variante",
                  "price_1": "<strong>Standard</strong><br />Der Klassiker in Schwarz.<br />✅ Alle Ergonomie-Features<br />✅ 3 Jahre Garantie<br /><strong>399 €</strong>",
                  "price_2": "<strong>Pro</strong><br />Mit Kopfstütze & Premium-Rollen.<br />✅ Inkl. Nackenstütze<br />✅ 5 Jahre Garantie<br /><strong>499 €</strong>",
                  "price_3": "<strong>Leder Edition</strong><br />Echtes Nappaleder für Chefs.<br />✅ Feinste Materialien<br />✅ 10 Jahre Garantie<br /><strong>799 €</strong>",
                  "faq_1": "Ist der Stuhl für große Menschen geeignet?",
                  "faq_answer_1": "Ja, der BackHero Pro ist für Körpergrößen von 1,60m bis 1,95m ideal geeignet und bis 150kg belastbar.",
                  "faq_2": "Kann ich den Stuhl testen?",
                  "faq_answer_2": "Natürlich! Wir bieten eine 30-Tage-Probewohnen-Garantie. Wenn er dir nicht gefällt, holen wir ihn kostenlos wieder ab.",
                  "faq_3": "Wie schwer ist der Aufbau?",
                  "faq_answer_3": "Der Aufbau ist kinderleicht und dauert dank vormontierter Teile nur etwa 10 Minuten. Werkzeug liegt bei.",
                  "faq_4": "Sind die Rollen für Parkett geeignet?",
                  "faq_answer_4": "Ja, wir liefern standardmäßig Universal-Soft-Rollen mit, die deinen Parkett- oder Laminatboden schützen.",
                  "faq_5": "Gibt es Ersatzteile?",
                  "faq_answer_5": "Ja, wir halten alle Ersatzteile mindestens 10 Jahre lang auf Lager, damit du lange Freude an deinem Stuhl hast.",
                  "contact_info": "Noch Fragen? Unser Kundenservice hilft dir gerne weiter.",
                  "footer_cta": "Jetzt versandkostenfrei bestellen",
                  "trust_signals": "30 Tage Rückgaberecht | Kostenloser Versand | Kauf auf Rechnung",
                  "guarantee_text": "30 Tage Geld-zurück-Garantie ohne Wenn und Aber."
                }`
            }
        };
    }

    async checkContent(contentData, keyword) {
        const result = {
            keyword,
            flaggedClaims: [],
            confidenceScore: 95,
        };
        
        const fieldsToCheck = ['hero_text', 'social_proof', 'guarantee_text', 'meta_description', 'benefits_list', 'features_list', 'benefits_list_fließtext', 'features_list_fließtext', 'testimonial_1', 'testimonial_2', 'h2_1_text', 'h2_2_text', 'h2_3_text', 'h2_4_text' ];
        let penalty = 0;

        fieldsToCheck.forEach(field => {
            if (contentData[field]) {
                Object.keys(this.problematicPhrases).forEach(phrase => {
                    const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
                    if (regex.test(contentData[field])) {
                        const { severity } = this.problematicPhrases[phrase];
                        penalty += (severity === 'high' ? 15 : (severity === 'medium' ? 10 : 5));
                        result.flaggedClaims.push({ original: phrase, field, severity });
                    }
                });
            }
        });

        result.confidenceScore = Math.max(30, 95 - penalty);
        console.log(`E-E-A-T Check für '${keyword}': Score ${result.confidenceScore}%, ${result.flaggedClaims.length} problematische Phrasen gefunden.`);
        return result;
    }

    generateResponsiblePrompt(keywordData) {
        // Extrahiere alle Daten inklusive 'semanticTerms' und 'readability'
        const { keyword, intent, zielgruppe, tonalitaet, usp, domain, email, phone, address, brand, grammaticalPerson, customStyle, semanticTerms, readability } = keywordData;

        // --- LOGIK FÜR ANREDE (DU vs. SIE) ---
        let anredeInstruktion = "";
        if (tonalitaet) {
            const t = tonalitaet.toLowerCase();
            if (t.includes('du') || t.includes('locker') || t.includes('freundschaftlich') || t.includes('persönlich')) {
                anredeInstruktion = "- **WICHTIG - ANREDE:** Sprich den Leser konsequent mit 'Du' an (Duzen). Nutze eine persönliche, direkte Ansprache. Vermeide das 'Sie'.";
            } else if (t.includes('sie') || t.includes('formell') || t.includes('seriös') || t.includes('geschäftlich')) {
                anredeInstruktion = "- **WICHTIG - ANREDE:** Sprich den Leser konsequent mit 'Sie' an (Siezen). Bleibe höflich, professionell und wahre Distanz.";
            }
        }

        // --- LOGIK FÜR LESBARKEIT (FLESCH-INDEX) ---
        let readabilityInstruction = "";
        switch (readability) {
            case 'simple':
                readabilityInstruction = `
                - **LEICHTE VERSTÄNDLICHKEIT (Priorität!):**
                  - Nutze kurze, klare Sätze (max. 15 Wörter).
                  - Vermeide Fremdwörter oder erkläre sie sofort.
                  - Adressiere den Leser direkt und auf Augenhöhe.
                  - Ziel: Flesch-Reading-Ease Score von > 60 (leicht verständlich).`;
                break;
            case 'expert':
                readabilityInstruction = `
                - **EXPERTEN-NIVEAU:**
                  - Setze Fachwissen und Branchenkenntnisse voraus.
                  - Nutze präzise Fachterminologie (ohne sie jedes Mal zu erklären).
                  - Du darfst komplexe Satzstrukturen nutzen, wenn sie der Präzision dienen.
                  - Fokussiere dich auf Tiefe und Details statt auf Oberflächlichkeit.`;
                break;
            case 'academic':
                readabilityInstruction = `
                - **AKADEMISCHER STIL:**
                  - Schreibe objektiv, differenziert und evidenzbasiert.
                  - Nutze ein gehobenes Vokabular und komplexe Argumentationsketten.
                  - Vermeide Umgangssprache vollständig.`;
                break;
            default: // 'balanced' oder undefined
                readabilityInstruction = `
                - **AUSGEWOGENER STIL:**
                  - Schreibe professionell, aber zugänglich.
                  - Finde die Balance zwischen Fachwissen und Verständlichkeit.
                  - Erkläre komplexe Begriffe kurz, aber behandle den Leser nicht wie ein Kind.`;
        }

        // --- LOGIK FÜR STIL & TEMPLATE AUSWAHL ---
        let styleInstruction = "";
        let selectedTemplateKey = 'service';

        if (customStyle && customStyle.length > 15) {
            console.log(`[PROMPT] Nutze Custom-Style für Keyword: ${keyword}`);
            styleInstruction = `
            --- STIL-VORLAGE (EXTREM WICHTIG!) ---
            Der Nutzer hat folgenden Text als exakte Referenz für den gewünschten Schreibstil, Satzbau, Wortwahl und Ansprache bereitgestellt:
            
            "${customStyle}"
            
            ANWEISUNG: Analysiere den Stil dieses Mustertextes genau. 
            1. Übernimm die Tonalität.
            2. Übernimm die Ansprache (Du/Sie) aus dem Mustertext.
            3. Übernimm die Satzstruktur.
            4. Wende diesen Stil auf das neue Thema "${keyword}" an.
            `;
        } else {
            const productKeywords = ['kaufen', 'shop', 'bestellen', 'preis', 'produkt', 'versand', 'lieferung', 'warenkorb'];
            const isProductContext = productKeywords.some(pk => keyword.toLowerCase().includes(pk)) || 
                                     (intent === 'commercial' && zielgruppe && zielgruppe.toLowerCase().includes('käufer'));
            
            if (isProductContext) {
                selectedTemplateKey = 'product';
            }
            
            console.log(`[PROMPT] Nutze Built-in Template '${selectedTemplateKey}' für Keyword: ${keyword}`);
            const selectedTemplate = this.templates[selectedTemplateKey];
            styleInstruction = `
            Hier ist ein Beispiel für einen perfekten, faktenbasierten JSON-Output (${selectedTemplate.description}):
            ${selectedTemplate.json}
            
            Orientiere dich an der Struktur und Qualität dieses Beispiels, aber passe den Inhalt zu 100% auf das neue Thema "${keyword}" an.
            `;
        }

        const roleAndTask = intent === 'commercial'
            ? 'Du bist ein erstklassiger, menschenähnlicher Marketing-Texter und Conversion-Optimierer. Dein Stil ist verkaufspsychologisch fundiert, aktiviert den Leser emotional und führt zielsicher zur Handlung.'
            : 'Du bist ein menschenähnlicher Fachexperte und objektiver Ratgeber. Dein Stil ist journalistisch sauber, tiefgehend recherchiert und bietet echten Nutzwert ohne werbliche Floskeln.';

        let kontext = "";
        if (brand) kontext += `- BRAND/ANSPRECHPARTNER: ${brand}\n`;
        if (zielgruppe) kontext += `- ZIELGRUPPE: ${zielgruppe}\n`;
        if (tonalitaet) kontext += `- TONALITÄT (Allgemein): ${tonalitaet}\n`;
        if (usp) kontext += `- ALLEINSTELLUNGSMERKMAL (USP): ${usp}\n`;
        if (domain) kontext += `- WEBSEITE: ${domain}\n`;
        if (email) kontext += `- E-MAIL FÜR CTA: ${email}\n`;
        if (phone) kontext += `- TELEFONNUMMER FÜR CTA: ${phone}\n`;
        if (address) kontext += `- ADRESSE FÜR CTA: ${address}\n`;
        if (grammaticalPerson) kontext += `- ABSENDER-PERSPEKTIVE: ${grammaticalPerson === 'plural' ? 'Wir-Form (Wir als Unternehmen bieten an)' : 'Ich-Form (Ich als Experte biete an)'}\n`;

        // Semantische Instruktion bauen
        let seoInstruction = "";
        if (semanticTerms && semanticTerms.length > 0) {
            seoInstruction = `
            🌟 SEO-OPTIMIERUNG (ENTITY INTEGRATION):
            Um die thematische Tiefe (TF-IDF) zu erhöhen, integriere bitte die folgenden semantisch verwandten Begriffe NATÜRLICH in den Textverlauf (kein Keyword-Stuffing!):
            "${semanticTerms}"
            Nutze diese Begriffe, um Kontext herzustellen und Expertise zu beweisen.
            `;
        }

        return `
            ${styleInstruction}

            ---

            Erstelle jetzt einen ebenso hochwertigen und FAKTISCH VERANTWORTLICHEN JSON-Output für das Thema "${keyword}".

            ${kontext ? `ZUSÄTZLICHER KONTEXT, DER UNBEDINGT ZU BEACHTEN IST:\n${kontext}` : ''}
            
            ${seoInstruction}

            ROLLE: ${roleAndTask}

            🚨 WICHTIGE RICHTLINIEN & QUALITÄTSSICHERUNG:
            ${anredeInstruktion}
            ${readabilityInstruction}
            
            👉 **ORTHOGRAFIE & GRAMMATIK (KRITISCH):**
            - Der Text MUSS in einwandfreiem Deutsch (Neue Rechtschreibung) verfasst sein.
            - Prüfe JEDEN Satz auf Tippfehler und grammatikalische Korrektheit.
            - Zeichensetzung muss präzise sein (Kommasetzung!).
            - Vermeide unnötiges "Denglisch". Nutze deutsche Begriffe, es sei denn, es handelt sich um feststehende Marketing-Fachbegriffe.

            - **Kein KI-Geschwafel:** Vermeide leere Phrasen wie "In der heutigen digitalen Welt", "Tauchen wir ein" oder "Es ist wichtig zu beachten". Starte direkt mit dem Mehrwert.
            - **Satzstruktur:** Variiere zwischen kurzen, prägnanten Sätzen und längeren Erklärungen. Das wirkt menschlicher.
            - **Meta-Daten:** "meta_title" max. 55 Zeichen, "meta_description" max. 155 Zeichen. Nutze Symbole (➤, ✓) für höhere Klickraten.
            - **Titel:** VERWENDE für "post_title" immer das keyword.
            - **Vermeidung:** VERMEIDE Superlative wie "beste", "Nummer 1", "Marktführer" und absolute Begriffe wie "garantiert", "100%", "immer", "nie", es sei denn, sie sind im USP explizit gefordert.
            - **Formatierung:** Nutze HTML-Listen (<ul><li>) in den Listen-Feldern.
            - **JSON:** Deine Antwort MUSS ein einziges, valides JSON-Objekt sein. Beginne direkt mit { und ende mit }.

            Das JSON-Objekt muss exakt diese Struktur haben und alle Felder müssen gefüllt sein:
            {
              "post_title": "...",
              "post_name": "...",
              "meta_title": "...",
              "meta_description": "...",
              "h1": "...",
              "h2_1": "...",
              "h2_1_text": "...",
              "h2_2": "...",
              "h2_2_text": "...",
              "h2_3": "...",
              "h2_3_text": "...",
              "h2_4": "...",
              "h2_4_text": "...",
              "primary_cta": "...",
              "secondary_cta": "...",
              "hero_text": "...",
              "hero_subtext": "...",
              "benefits_list_fließtext": "...",
              "benefits_list": "...",
              "features_list_fließtext": "...",
              "features_list": "...",
              "social_proof": "...",
              "testimonial_1": "...",
              "testimonial_2": "...",
              "pricing_title": "...",
              "price_1": "...",
              "price_2": "...",
              "price_3": "...",
              "faq_1": "...",
              "faq_answer_1": "...",
              "faq_2": "...",
              "faq_answer_2": "...",
              "faq_3": "...",
              "faq_answer_3": "...",
              "faq_4": "...",
              "faq_answer_4": "...",
              "faq_5": "...",
              "faq_answer_5": "...",
              "contact_info": "...",
              "footer_cta": "...",
              "trust_signals": "...",
              "guarantee_text": "..."
            }
        `;
    }
}

