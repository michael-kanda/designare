// api/schema.js
// Liefert das komplette JSON-LD Schema inkl. AggregateRating für eine Seite
// Upstash REST API Version

import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Berechnet das AggregateRating aus den Feedback-Stats
function calculateRating(stats) {
    const total = (stats.positive || 0) + (stats.neutral || 0) + (stats.negative || 0);
    
    if (total === 0) return null;
    
    // Gewichtung: positive=5, neutral=3, negative=1
    const scoreSum = (stats.positive * 5) + (stats.neutral * 3) + (stats.negative * 1);
    const average = (scoreSum / total).toFixed(1);
    
    return {
        "@type": "AggregateRating",
        "ratingValue": average,
        "bestRating": "5",
        "worstRating": "1",
        "ratingCount": total.toString()
    };
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Cache für 1 Stunde (CDN) + 5 Min (Browser)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=300');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Nur GET erlaubt' });

    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'Slug fehlt' });

    try {
        const kvKey = `feedback:${slug}`;
        const data = await redis.get(kvKey);
        const stats = data || { positive: 0, neutral: 0, negative: 0 };
        
        const aggregateRating = calculateRating(stats);
        
        return res.status(200).json({
            success: true,
            slug,
            stats,
            aggregateRating // null wenn keine Bewertungen
        });

    } catch (error) {
        console.error('Schema API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
