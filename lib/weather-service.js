// lib/weather-service.js - Wetter via Open-Meteo (kostenlos, kein API-Key)
// Cached über Upstash Redis (30 Min TTL)
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const CACHE_TTL_SECONDS = 1800; // 30 Minuten
const CACHE_KEY_PREFIX = 'weather:';

// Wien als Default
const DEFAULT_LOCATION = { lat: 48.2082, lon: 16.3738, name: 'Wien' };

// WMO Weather Code → deutsches Label + kurze Beschreibung
const WMO_CODES = {
  0: { label: 'Klar', desc: 'wolkenlos' },
  1: { label: 'Überwiegend klar', desc: 'fast wolkenlos' },
  2: { label: 'Teilweise bewölkt', desc: 'ein paar Wolken' },
  3: { label: 'Bewölkt', desc: 'bedeckt' },
  45: { label: 'Nebel', desc: 'nebelig' },
  48: { label: 'Nebel mit Reif', desc: 'Nebel und Reif' },
  51: { label: 'Leichter Nieselregen', desc: 'nieselt leicht' },
  53: { label: 'Nieselregen', desc: 'nieselt' },
  55: { label: 'Starker Nieselregen', desc: 'nieselt kräftig' },
  56: { label: 'Gefrierender Nieselregen', desc: 'Glatteisgefahr' },
  57: { label: 'Starker gefrierender Nieselregen', desc: 'Glatteisgefahr' },
  61: { label: 'Leichter Regen', desc: 'regnet leicht' },
  63: { label: 'Regen', desc: 'regnet' },
  65: { label: 'Starker Regen', desc: 'regnet kräftig' },
  66: { label: 'Gefrierender Regen', desc: 'Eisregen' },
  67: { label: 'Starker gefrierender Regen', desc: 'starker Eisregen' },
  71: { label: 'Leichter Schneefall', desc: 'schneit leicht' },
  73: { label: 'Schneefall', desc: 'schneit' },
  75: { label: 'Starker Schneefall', desc: 'schneit kräftig' },
  77: { label: 'Schneekörner', desc: 'Graupel' },
  80: { label: 'Leichte Regenschauer', desc: 'kurze Schauer' },
  81: { label: 'Regenschauer', desc: 'Schauer' },
  82: { label: 'Starke Regenschauer', desc: 'heftige Schauer' },
  85: { label: 'Leichte Schneeschauer', desc: 'Schneeschauer' },
  86: { label: 'Starke Schneeschauer', desc: 'heftige Schneeschauer' },
  95: { label: 'Gewitter', desc: 'Gewitter' },
  96: { label: 'Gewitter mit Hagel', desc: 'Gewitter und Hagel' },
  99: { label: 'Starkes Gewitter mit Hagel', desc: 'heftiges Gewitter mit Hagel' },
};

/**
 * Wetterdaten von Open-Meteo holen (mit Cache).
 * @param {{ lat?: number, lon?: number, name?: string }} location
 * @returns {Promise<Object|null>} Aufbereitete Wetterdaten
 */
export async function getWeather(location = {}) {
  const { lat, lon, name } = { ...DEFAULT_LOCATION, ...location };
  const cacheKey = `${CACHE_KEY_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}`;

  // ── Cache prüfen ──
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`🌤️ Wetter-Cache Hit für ${name}`);
      return typeof cached === 'string' ? JSON.parse(cached) : cached;
    }
  } catch (err) {
    console.warn('⚠️ Redis Cache-Fehler (Wetter):', err.message);
  }

  // ── API-Call ──
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lon);
    url.searchParams.set('current', [
      'temperature_2m',
      'apparent_temperature',
      'weather_code',
      'wind_speed_10m',
      'relative_humidity_2m',
      'is_day'
    ].join(','));
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code');
    url.searchParams.set('timezone', 'Europe/Vienna');
    url.searchParams.set('forecast_days', '1');

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error(`❌ Open-Meteo API Error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const current = data.current;
    const daily = data.daily;

    const weatherCode = current.weather_code;
    const wmoInfo = WMO_CODES[weatherCode] || { label: 'Unbekannt', desc: 'unbekanntes Wetter' };

    const result = {
      location: name,
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(current.apparent_temperature),
      condition: wmoInfo.label,
      conditionDesc: wmoInfo.desc,
      weatherCode,
      windSpeed: Math.round(current.wind_speed_10m),
      humidity: current.relative_humidity_2m,
      isDay: current.is_day === 1,
      dailyMax: daily ? Math.round(daily.temperature_2m_max[0]) : null,
      dailyMin: daily ? Math.round(daily.temperature_2m_min[0]) : null,
      fetchedAt: new Date().toISOString()
    };

    // ── Cache speichern ──
    try {
      await redis.set(cacheKey, JSON.stringify(result), { ex: CACHE_TTL_SECONDS });
      console.log(`🌤️ Wetter gecacht für ${name}: ${result.temperature}°C, ${result.condition}`);
    } catch (err) {
      console.warn('⚠️ Redis Cache-Speicherfehler:', err.message);
    }

    return result;

  } catch (err) {
    console.error('❌ Open-Meteo Fetch-Fehler:', err.message);
    return null;
  }
}

/**
 * Geocoding über Open-Meteo – Stadt → Koordinaten
 * @param {string} cityName
 * @returns {Promise<{ lat: number, lon: number, name: string } | null>}
 */
export async function geocodeCity(cityName) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=de`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;

    const result = data.results[0];
    return {
      lat: result.latitude,
      lon: result.longitude,
      name: result.name
    };
  } catch (err) {
    console.error('❌ Geocoding-Fehler:', err.message);
    return null;
  }
}

/**
 * Baut einen kurzen Wetter-Kontext-String für den System-Prompt.
 * Wird bei der ersten Nachricht einer Session aufgerufen.
 * @returns {Promise<string>}
 */
export async function getWeatherContext() {
  const weather = await getWeather();
  if (!weather) return '';

  const { temperature, feelsLike, condition, conditionDesc, windSpeed, isDay, dailyMax, dailyMin } = weather;

  let context = `Aktuelles Wetter in Wien: ${temperature}°C (gefühlt ${feelsLike}°C), ${conditionDesc}`;

  if (dailyMax !== null && dailyMin !== null) {
    context += `, Tagesbereich ${dailyMin}°–${dailyMax}°C`;
  }

  if (windSpeed > 30) {
    context += `, starker Wind (${windSpeed} km/h)`;
  }

  // Stimmungs-Hinweis für Evita
  if (temperature >= 30) {
    context += '. Richtig heiß heute – Evita darf das gerne kommentieren.';
  } else if (temperature <= 0) {
    context += '. Eiskalt draußen – gut dass man drinnen coden kann.';
  } else if ([61, 63, 65, 80, 81, 82].includes(weather.weatherCode)) {
    context += '. Regenwetter – perfekter Tag zum Drinnenbleiben und Projekte voranbringen.';
  } else if ([0, 1].includes(weather.weatherCode) && isDay && temperature >= 20) {
    context += '. Traumwetter draußen!';
  }

  return context;
}
