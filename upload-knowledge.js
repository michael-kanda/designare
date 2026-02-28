import fs from 'fs';
import { Index } from "@upstash/vector";
import { GoogleGenerativeAI } from "@google/generative-ai";
// Die dotenv-Zeile können wir hier sogar löschen, da wir sie umgehen

// 1. Initialisiere die Clients mit FESTEN Werten (Achtung: Anführungszeichen nicht vergessen!)
const genAI = new GoogleGenerativeAI("HIER_DEIN_GEMINI_KEY_EINTRAGEN");

const vectorIndex = new Index({
  url: "HIER_KEY_EINTRAGEN", // Deine echte URL
  token: "HIER_KEY_EINTRAGEN", // Dein echter Token
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
    const pages = kbData.pages || kbData; 

    // WICHTIG: Muss mit rag-service.js übereinstimmen (gemini-embedding-001 + slice 768)
    const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

    // 3. Verarbeite jeden Eintrag
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const textToEmbed = `${page.title}\n${page.meta_description || ''}\n${page.text || page.content}`;
        
        try {
            console.log(`⏳ Verarbeite [${i + 1}/${pages.length}]: ${page.title}`);
            
            const result = await embeddingModel.embedContent(textToEmbed);
            // WICHTIG: Auf 768 Dimensionen kürzen – muss mit rag-service.js matchen
            const denseVector = result.embedding.values.slice(0, 768);

            await vectorIndex.upsert({
                id: `page_${page.slug || i}`,
                vector: denseVector,
                data: textToEmbed,
                metadata: {
                    title: page.title,
                    url: page.url,
                    content: page.text || page.content
                }
            });

            await new Promise(res => setTimeout(res, 500)); 

        } catch (error) {
            console.error(`❌ Fehler bei Seite ${page.title}:`, error.message);
        }
    }

    console.log("✅ Upload abgeschlossen! Dein Index ist jetzt gefüllt.");
}

uploadKnowledge();
