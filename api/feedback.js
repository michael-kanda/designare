// api/feedback.js
// Upstash REST API - keine Verbindungsprobleme mehr!

import { Redis } from '@upstash/redis';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const slug = req.query.slug || req.body?.slug;
    if (!slug) return res.status(400).json({ error: 'Slug fehlt' });

    const kvKey = `feedback:${slug}`;

    try {
        if (req.method === 'GET') {
            const data = await redis.get(kvKey);
            const stats = data || { positive: 0, neutral: 0, negative: 0 };
            const total = (stats.positive || 0) + (stats.neutral || 0) + (stats.negative || 0);
            
            return res.status(200).json({
                success: true,
                stats,
                total,
                percentages: {
                    positive: total > 0 ? Math.round((stats.positive / total) * 100) : 0,
                    neutral: total > 0 ? Math.round((stats.neutral / total) * 100) : 0,
                    negative: total > 0 ? Math.round((stats.negative / total) * 100) : 0
                }
            });
        }

        if (req.method === 'POST') {
            const { vote } = req.body;
            if (!['positive', 'neutral', 'negative'].includes(vote)) {
                return res.status(400).json({ error: 'Ungültiger Vote' });
            }

            let data = await redis.get(kvKey);
            data = data || { positive: 0, neutral: 0, negative: 0 };

            data[vote] = (data[vote] || 0) + 1;
            
            await redis.set(kvKey, data);

            const total = data.positive + data.neutral + data.negative;
            
            return res.status(200).json({
                success: true,
                stats: data,
                total,
                percentages: {
                    positive: total > 0 ? Math.round((data.positive / total) * 100) : 0,
                    neutral: total > 0 ? Math.round((data.neutral / total) * 100) : 0,
                    negative: total > 0 ? Math.round((data.negative / total) * 100) : 0
                }
            });
        }

        return res.status(405).json({ error: 'Methode nicht erlaubt' });

    } catch (error) {
        console.error('Feedback API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
