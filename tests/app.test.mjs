import test from 'node:test';
import assert from 'node:assert/strict';
import { stateLabel, isSafeMapsUrl, storageKey, saveId, hasValidMapLocation, hasValidWeatherConfig, buildOpenMeteoUrl, isOpenMeteoOutOfRangePayload, parseOpenMeteoDaily, WeatherOutOfRangeError, weatherCodeLabel } from '../helpers.js';
import { DailyWeatherController, WEATHER_CACHE_TTL_MS } from '../weather.js';

test('state labels distinguish every source state', () => {
  assert.equal(stateLabel('confirmed'), '已確認');
  assert.equal(stateLabel('candidate'), '候選');
  assert.equal(stateLabel('backup'), '備案');
  assert.equal(stateLabel('pending'), '待確認');
});

test('only public Google Maps navigation URLs are accepted', () => {
  assert.equal(isSafeMapsUrl('https://www.google.com/maps/search/?api=1&query=Tokyo'), true);
  assert.equal(isSafeMapsUrl('https://example.com/maps'), false);
  assert.equal(isSafeMapsUrl('javascript:alert(1)'), false);
});

test('local state keys stay namespaced and stable', () => {
  assert.equal(storageKey('checklist', '0'), 'ss-travel-console:v1:checklist:0');
});

test('save pins use the save identity rather than a filtered list index', () => {
  assert.equal(saveId({ cityArea: '東京', label: '室內備案' }), '東京|室內備案');
});

test('public map locations require finite latitude and longitude', () => {
  assert.equal(hasValidMapLocation({ lat: 35.6473, lng: 140.0346 }), true);
  assert.equal(hasValidMapLocation({ lat: 91, lng: 140.0346 }), false);
  assert.equal(hasValidMapLocation({ lat: 35.6473, lng: '140.0346' }), false);
  assert.equal(hasValidMapLocation(null), false);
});

test('weather config exactly covers all 11 public dates and has no private metadata', async () => {
  const [{ default: config }, { default: trip }] = await Promise.all([
    import('../data/weather-locations.json', { with: { type: 'json' } }),
    import('../data/trip-data.json', { with: { type: 'json' } }),
  ]);
  assert.equal(config.locations.length, 11);
  assert.ok(hasValidWeatherConfig(config, trip.dailyPlans.map((day) => day.date)));
  assert.deepEqual(config.locations[6], { date: '2026-08-19', locationLabel: '輕井澤（跨區日代表地區）', lat: 36.3391616, lng: 138.6331098 });
  assert.ok(config.locations.every((location) => Object.keys(location).sort().join(',') === 'date,lat,lng,locationLabel'));
});

test('Open-Meteo URL uses only the allowlisted HTTPS forecast endpoint and required params', () => {
  const url = buildOpenMeteoUrl({ date: '2026-08-13', locationLabel: '千葉幕張', lat: 35.6473019, lng: 140.0346524 });
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.pathname, '/v1/forecast');
  assert.equal(url.searchParams.get('timezone'), 'Asia/Tokyo');
  assert.equal(url.searchParams.get('start_date'), '2026-08-13');
  assert.equal(url.searchParams.get('end_date'), '2026-08-13');
  assert.equal(url.searchParams.get('daily'), 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max');
  assert.throws(() => buildOpenMeteoUrl({ date: 'bad', locationLabel: '<unsafe>', lat: 0, lng: 0 }), TypeError);
});

const validWeatherPayload = (date = '2026-08-13') => ({ timezone: 'Asia/Tokyo', daily: { time: [date], weather_code: [2], temperature_2m_max: [31.4], temperature_2m_min: [25.1], precipitation_probability_max: [50], precipitation_sum: [3.2], wind_speed_10m_max: [14.8] } });

test('weather response parser rejects malformed, unsafe, and nonmatching response data', () => {
  assert.deepEqual(parseOpenMeteoDaily(validWeatherPayload(), '2026-08-13'), { date: '2026-08-13', weatherCode: 2, temperatureMax: 31.4, temperatureMin: 25.1, precipitationProbabilityMax: 50, precipitationSum: 3.2, windSpeedMax: 14.8 });
  assert.throws(() => parseOpenMeteoDaily({ daily: { time: ['2026-08-13'] } }, '2026-08-13'), TypeError);
  const unsafe = validWeatherPayload(); unsafe.daily.temperature_2m_max = [Infinity];
  assert.throws(() => parseOpenMeteoDaily(unsafe, '2026-08-13'), TypeError);
  assert.throws(() => parseOpenMeteoDaily(validWeatherPayload('2026-08-14'), '2026-08-13'), WeatherOutOfRangeError);
  assert.throws(() => parseOpenMeteoDaily({ ...validWeatherPayload(), timezone: 'UTC' }, '2026-08-13'), TypeError);
  const impossibleProbability = validWeatherPayload(); impossibleProbability.daily.precipitation_probability_max = [101];
  assert.throws(() => parseOpenMeteoDaily(impossibleProbability, '2026-08-13'), TypeError);
  assert.equal(isOpenMeteoOutOfRangePayload({ error: true, reason: "Parameter 'start_date' is out of allowed range" }), true);
  assert.equal(isOpenMeteoOutOfRangePayload({ error: true, reason: 'invalid latitude' }), false);
});

test('weather response parser enforces broad physical ranges and temperature order', () => {
  const withValues = ({ code = 0, max = 70, min = -100, probability = 100, rain = 2500, wind = 500 } = {}) => ({
    timezone: 'Asia/Tokyo',
    daily: {
      time: ['2026-08-13'], weather_code: [code], temperature_2m_max: [max], temperature_2m_min: [min],
      precipitation_probability_max: [probability], precipitation_sum: [rain], wind_speed_10m_max: [wind],
    },
  });
  assert.doesNotThrow(() => parseOpenMeteoDaily(withValues(), '2026-08-13'));
  for (const payload of [
    withValues({ max: 70.1 }), withValues({ min: -100.1 }), withValues({ max: 10, min: 11 }),
    withValues({ code: -1 }), withValues({ code: 1.5 }), withValues({ probability: -0.1 }),
    withValues({ probability: 100.1 }), withValues({ rain: -0.1 }), withValues({ rain: 2500.1 }),
    withValues({ wind: -0.1 }), withValues({ wind: 500.1 }),
    withValues({ max: 1e100, min: -1e100, wind: 1e100 }),
  ]) assert.throws(() => parseOpenMeteoDaily(payload, '2026-08-13'), TypeError);
});

test('WMO mappings cover specified common codes and keep unknown code unconfirmed', () => {
  for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) assert.notEqual(weatherCodeLabel(code).description, '天氣狀況待確認');
  assert.deepEqual(weatherCodeLabel(999), { icon: '❔', description: '天氣狀況待確認' });
});

test('weather controller aborts stale requests, expires cache, and retry forces a new request', async () => {
  const states = []; let calls = 0; let aborted = false; let rejectPending; let now = Date.parse('2026-08-13T00:00:00Z');
  const location = { date: '2026-08-13', locationLabel: '千葉幕張', lat: 35.6473019, lng: 140.0346524 };
  const controller = new DailyWeatherController({
    now: () => now, onStateChange: (state) => states.push(state),
    fetchImpl: async () => { calls += 1; return { ok: true, json: async () => validWeatherPayload() }; },
  });
  await controller.load(location);
  await controller.load(location);
  assert.equal(calls, 1);
  now += WEATHER_CACHE_TTL_MS + 1;
  await controller.load(location);
  assert.equal(calls, 2);
  await controller.retry();
  assert.equal(calls, 3);
  controller.fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => { rejectPending = reject; signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('abort'), { name: 'AbortError' })); }); });
  const stale = controller.load({ ...location, date: '2026-08-14' });
  const current = controller.load(location);
  await Promise.all([stale, current]);
  assert.equal(aborted, true);
  assert.equal(typeof rejectPending, 'function');
  assert.equal(states.filter((state) => state.status === 'loaded').length >= 2, true);
});

test('weather controller classifies the real Open-Meteo HTTP 400 range response without fabricating data', async () => {
  const states = [];
  const controller = new DailyWeatherController({
    onStateChange: (state) => states.push(state),
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: "Parameter 'start_date' is out of allowed range" }) }),
  });
  await controller.load({ date: '2027-01-01', locationLabel: '千葉幕張', lat: 35.6473019, lng: 140.0346524 });
  assert.equal(states.at(-1).status, 'out-of-range');
});

test('daily weather renderer contract keeps accessible state panels, safe source links, and retry', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../app.js', import.meta.url), 'utf8');
  const styles = await (await import('node:fs/promises')).readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(source, /id="daily-weather-panel"/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /data-weather-retry/);
  assert.match(source, /target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo\.com/);
  assert.match(source, /https:\/\/open-meteo\.com\/en\/licence/);
  assert.match(source, /公開代表座標.*不會傳送整份行程或私人資料/);
  assert.match(source, /import \{ DailyWeatherController \} from '\.\/weather\.js/);
  const weatherSource = await (await import('node:fs/promises')).readFile(new URL('../weather.js', import.meta.url), 'utf8');
  assert.match(weatherSource, /AbortController/);
  assert.match(weatherSource, /fetchImpl = \(\.\.\.args\) => globalThis\.fetch\(\.\.\.args\)/);
  assert.match(weatherSource, /WEATHER_CACHE_TTL_MS = 15 \* 60 \* 1000/);
  assert.match(source, /fetch\('\.\/data\/weather-locations\.json'.*\.catch\(\(\) => null\)/);
  const weatherConfig = await (await import('node:fs/promises')).readFile(new URL('../data/weather-locations.json', import.meta.url), 'utf8');
  assert.match(weatherConfig, /跨區日代表地區/);
  assert.match(styles, /\.weather-metrics \{[^}]*grid-template-columns: repeat\(4, minmax\(9rem, 1fr\)\)/);
  assert.match(styles, /\.weather-retry \{ min-width: 44px/);
});

test('travel snapshot supplies a valid map location for every public navigation entry', async () => {
  const { default: trip } = await import('../data/trip-data.json', { with: { type: 'json' } });
  const navigation = trip.dailyPlans.flatMap((day) => day.navigation);
  assert.equal(navigation.length, 26);
  assert.ok(navigation.every((entry) => hasValidMapLocation(entry.mapLocation)));
});

test('designated official itinerary is synchronized across all 11 days', async () => {
  const { default: trip } = await import('../data/trip-data.json', { with: { type: 'json' } });
  assert.equal(trip.officialItinerary.status, 'official');
  assert.equal(trip.officialItinerary.sourceLabel, '使用者指定正式版行程（公開安全摘要）');
  assert.deepEqual(
    trip.dailyPlans.map((day) => day.date),
    Array.from({ length: 11 }, (_, index) => `2026-08-${String(13 + index).padStart(2, '0')}`),
  );
  const itinerary = new Map(trip.dailyPlans.map((day) => [day.date, day.highLevelItinerary.join('｜')]));
  assert.match(itinerary.get('2026-08-15'), /木更津港祭煙火大會/);
  assert.match(itinerary.get('2026-08-17'), /八ッ場水壩/);
  assert.match(itinerary.get('2026-08-18'), /四萬甌穴群/);
  assert.match(itinerary.get('2026-08-19'), /奧四萬湖.*伊香保溫泉石段街.*碓冰峠眼鏡橋/s);
  assert.match(itinerary.get('2026-08-20'), /鬼押出園.*白絲瀑布.*Candle Night/s);
  const august22 = trip.dailyPlans.find((day) => day.date === '2026-08-22');
  assert.equal(august22.navigation.find((entry) => entry.label.includes('Ron Mueck')).state, 'candidate');
});

test('introduction snapshot covers the trip with safe official HTTPS sources', async () => {
  const { default: introductions } = await import('../data/introductions.json', { with: { type: 'json' } });
  assert.ok(introductions.items.length >= 12);
  assert.ok(introductions.items.every((item) => item.features.length >= 3));
  assert.ok(introductions.items.every((item) => item.background && item.familyTip));
  assert.ok(introductions.items.flatMap((item) => item.sources).every((source) => source.url.startsWith('https://')));
  assert.equal(new Set(introductions.items.flatMap((item) => item.sources.map((source) => source.ref))).size, 18);
  const expectedCandidates = new Set(introductions.candidateCoverage.names);
  const actualCandidates = new Set(introductions.items.filter((item) => item.state === 'candidate').map((item) => item.sourceName));
  assert.deepEqual(actualCandidates, expectedCandidates);
});

test('introduction photos are exactly six local licensed assets with required attribution', async () => {
  const { default: introductions } = await import('../data/introductions.json', { with: { type: 'json' } });
  const photos = introductions.items.filter((item) => item.photo);
  assert.equal(photos.length, 6);
  assert.deepEqual(photos.map((item) => item.id).sort(), [
    'candidate-iwami-kagura', 'candidate-yamba-roadside-station', 'karuizawa-nature-culture',
    'kusatsu-yubatake', 'shima-onsen', 'usui-railway',
  ]);
  for (const { photo } of photos) {
    assert.match(photo.src, /^assets\/introductions\/[a-z]+\.webp$/);
    assert.ok(photo.alt && photo.caption && photo.creator && photo.license);
    assert.match(photo.licenseUrl, /^https:\/\//);
    assert.match(photo.sourceUrl, /^https:\/\/commons\.wikimedia\.org\//);
  }
  assert.equal(introductions.items.find((item) => item.id === 'usui-railway').photo.caption, '碓冰峠眼鏡橋（碓冰第三橋梁）');
  assert.equal(introductions.items.find((item) => item.id === 'candidate-yamba-roadside-station').photo.caption, '鄰近的八ッ場水壩');
});

test('introduction photo renderer preserves accessible lazy image and attribution fallback contracts', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../app.js', import.meta.url), 'utf8');
  const styles = await (await import('node:fs/promises')).readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(source, /function introductionPhoto\(photo\)/);
  assert.match(source, /loading="lazy" decoding="async" width="1280" height="720"/);
  assert.match(source, /class="intro-photo-fallback" hidden role="status"/);
  assert.match(source, /image\.hidden = true/);
  assert.match(source, /本站版本經 16:9 裁切與 WebP 壓縮/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  assert.match(source, /escapeHtml\(photo\.(src|alt|caption|creator|license|licenseUrl|sourceUrl)\)/);
  assert.match(styles, /\.intro-photo img \{[^}]*width: 100%;[^}]*height: auto;[^}]*aspect-ratio: 16 \/ 9;/);
});
