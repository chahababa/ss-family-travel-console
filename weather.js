import { buildOpenMeteoUrl, isOpenMeteoOutOfRangePayload, parseOpenMeteoDaily, WeatherOutOfRangeError } from './helpers.js';

export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;

/** Fetches only the currently selected public weather location and protects UI from stale responses. */
export class DailyWeatherController {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args), onStateChange = () => {}, now = () => Date.now(), cacheTtlMs = WEATHER_CACHE_TTL_MS } = {}) {
    this.fetchImpl = fetchImpl;
    this.onStateChange = onStateChange;
    this.now = now;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
    this.activeAbortController = null;
    this.requestId = 0;
    this.lastLocation = null;
  }

  cancel() {
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }

  async load(location, { force = false } = {}) {
    this.lastLocation = location;
    const cacheKey = location.date;
    this.cancel();
    const currentRequest = ++this.requestId;
    if (!force && this.cache.has(cacheKey) && this.now() - this.cache.get(cacheKey).fetchedAtMs < this.cacheTtlMs) {
      const cached = this.cache.get(cacheKey);
      this.onStateChange({ status: 'loaded', location, weather: cached.weather, fetchedAt: cached.fetchedAt, cached: true });
      return cached.weather;
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;
    this.onStateChange({ status: 'loading', location });
    try {
      const response = await this.fetchImpl(buildOpenMeteoUrl(location), { signal: abortController.signal });
      if (!response?.ok) {
        const payload = await response?.json?.().catch(() => null);
        if (response?.status === 400 && isOpenMeteoOutOfRangePayload(payload)) throw new WeatherOutOfRangeError();
        throw new Error('Weather request failed');
      }
      const weather = parseOpenMeteoDaily(await response.json(), location.date);
      if (currentRequest !== this.requestId) return null;
      const fetchedAtMs = this.now();
      const fetchedAt = new Date(fetchedAtMs).toISOString();
      this.cache.set(cacheKey, { weather, fetchedAt, fetchedAtMs });
      this.onStateChange({ status: 'loaded', location, weather, fetchedAt, cached: false });
      return weather;
    } catch (error) {
      if (error?.name === 'AbortError' || currentRequest !== this.requestId) return null;
      const status = error instanceof WeatherOutOfRangeError ? 'out-of-range' : 'error';
      this.onStateChange({ status, location, error });
      return null;
    } finally {
      if (currentRequest === this.requestId) this.activeAbortController = null;
    }
  }

  retry() {
    return this.lastLocation ? this.load(this.lastLocation, { force: true }) : Promise.resolve(null);
  }
}
