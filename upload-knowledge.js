import fs from 'fs';
import { Index } from "@upstash/vector";
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'dotenv/config'; // Lädt deine .env Datei automatisch

// 1. Initialisiere die Clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

async function uploadKnowledge() {
    console.log("🚀 Starte Upload in die Upstash Vector Datenbank...");

    // 2. Lese die lokale JSON-Datei
    const kbPath = './knowledge.json';
    if (!fs.existsSync(kbPath)) {
        console.error("❌ knowledge.json nicht gefunden!");
        return;
    }

    const kbData = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
    // Falls deine JSON in einem "pages"-Objekt verpackt ist, ansonsten direkt das Array nutzen
    const pages = kbData.pages || kbData; 

    const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

    // 3. Verarbeite jeden Eintrag
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        
        // Den Text zusammenbauen, der vektorisiert werden soll
        const textToEmbed = `${page.title}\n${page.text || page.content}`;
        
        try {
            console.log(`⏳ Verarbeite [${i + 1}/${pages.length}]: ${page.title}`);
            
            // A. Dense Vektor von Gemini holen (Semantik)
            const result = await embeddingModel.embedContent(textToEmbed);
            const denseVector = result.embedding.values;

            // B. An Upstash Vector senden (Hybrid Upload)
            await vectorIndex.upsert({
                id: `page_${i}`,          // Eindeutige ID
                vector: denseVector,      // Dense Vektor für inhaltliche Suche
                data: textToEmbed,        // Rohtext für Sparse Vektor (Keywords)
                metadata: {               // Metadaten für die spätere Ausgabe an Evita
                    title: page.title,
                    url: page.url,
                    content: page.text || page.content
                }
            });

            // Kleines Delay, um API-Ratelimits bei Gemini zu vermeiden
            await new Promise(res => setTimeout(res, 500)); 

        } catch (error) {
            console.error(`❌ Fehler bei Seite ${page.title}:`, error.message);
        }
    }

    console.log("✅ Upload abgeschlossen! Dein Index ist jetzt gefüllt.");
}

uploadKnowledge();
