// lib/redis.js - Singleton Redis-Client
// Wird von allen Modulen importiert statt eigene Instanzen zu erstellen
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
