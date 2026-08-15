import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateLabel, isSafeMapsUrl, isSafeDriveFolderUrl, hasValidPrivateDocumentShortcuts, storageKey, saveId, hasValidMapLocation, hasValidWeatherConfig, buildOpenMeteoUrl, isOpenMeteoOutOfRangePayload, parseOpenMeteoDaily, WeatherOutOfRangeError, weatherCodeLabel, introductionTargetId, introductionQuickNavEntries, dailyIntroductionTargetId } from '../helpers.js';
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

test('private document shortcuts accept only five approved Google Drive folder URLs', async () => {
  const { default: config } = await import('../data/private-document-shortcuts.json', { with: { type: 'json' } });
  assert.equal(config.shortcuts.length, 5);
  assert.ok(hasValidPrivateDocumentShortcuts(config));
  assert.ok(config.shortcuts.every((shortcut) => isSafeDriveFolderUrl(shortcut.url)));
  assert.equal(hasValidPrivateDocumentShortcuts({ ...config, unexpected: 'metadata' }), false);
  assert.equal(hasValidPrivateDocumentShortcuts({
    ...config,
    shortcuts: config.shortcuts.map((shortcut, index) => index ? shortcut : { ...shortcut, unexpected: 'metadata' }),
  }), false);
  assert.equal(hasValidPrivateDocumentShortcuts({
    ...config,
    shortcuts: config.shortcuts.map((shortcut, index) => index === 4 ? { ...shortcut, url: config.shortcuts[0].url } : shortcut),
  }), false);
  const arbitraryFolderUrl = ['https://drive.google.com', '/drive/folders/', 'synthetic-unapproved'].join('');
  assert.equal(isSafeDriveFolderUrl(arbitraryFolderUrl), false);
  assert.equal(hasValidPrivateDocumentShortcuts({
    ...config,
    shortcuts: config.shortcuts.map((shortcut, index) => index === 4 ? { ...shortcut, url: arbitraryFolderUrl } : shortcut),
  }), false);
  const individualFileUrl = ['https://drive.google.com', '/file', '/d/example'].join('');
  const folderUrlWithQuery = ['https://drive.google.com', '/drive/folders', '/example', '?usp=', 'sharing'].join('');
  assert.equal(isSafeDriveFolderUrl(individualFileUrl), false);
  assert.equal(isSafeDriveFolderUrl(folderUrlWithQuery), false);
  assert.equal(isSafeDriveFolderUrl(`https://name@${new URL(config.shortcuts[0].url).host}${new URL(config.shortcuts[0].url).pathname}`), false);
  assert.equal(isSafeDriveFolderUrl('https://example.com/drive/folders/example'), false);
});

test('whole-artifact validator rejects literal and encoded sixth Drive folder URLs outside config', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'ss-private-doc-validator-'));
  try {
    await mkdir(join(fixture, 'scripts'), { recursive: true });
    await mkdir(join(fixture, 'data'), { recursive: true });
    await cp(new URL('../scripts/validate-private-document-shortcuts.py', import.meta.url), join(fixture, 'scripts', 'validate-private-document-shortcuts.py'));
    await cp(new URL('../data/private-document-shortcuts.json', import.meta.url), join(fixture, 'data', 'private-document-shortcuts.json'));
    execFileSync('git', ['init', '--quiet'], { cwd: fixture });
    const host = 'drive.google.com';
    const path = '/drive/folders/synthetic-unapproved-sixth';
    const fixtures = [
      `export const injected = 'https://${host}${path}';\n`,
      "export const injected = 'https:\\/\\/" + host + path + "';\n",
      "export const injected = 'https:\\u002f\\u002f" + host + path + "';\n",
      "export const injected = 'https:\\u002F\\u002F" + host + path + "';\n",
      "export const injected = 'https\\u003a\\u002f\\u002f" + host + path + "';\n",
      "export const injected = 'https\\x3A\\x2F\\x2f" + host + path + "';\n",
      "export const injected = 'https:\\u{2f}\\u{2F}" + host + path + "';\n",
      "export const injected = '\\u0068ttps://" + host + path + "';\n",
      "export const injected = '\\u{68}ttps\\u{3A}\\u{2f}\\u{2F}" + host + path + "';\n",
      `<a href="https${'&#58;'}//${host}${path}">fixture</a>\n`,
      `<a href="https${'&#58'}//${host}${path}">fixture</a>\n`,
      `<a href="https${'&#x3a;'}//${host}${path}">fixture</a>\n`,
      `<a href="https${'&colon;'}//${host}${path}">fixture</a>\n`,
      `<a href="https${'&#58;'}${'&#47;'}${'&#x2F;'}${host}${path}">fixture</a>\n`,
      "export const injected = 'https:\\x2f\\x2f" + host + path + "';\n",
    ];
    for (const injection of fixtures) {
      await writeFile(join(fixture, 'injected-source.html'), injection);
      execFileSync('git', ['add', '.'], { cwd: fixture });
      const result = spawnSync('python3', ['scripts/validate-private-document-shortcuts.py'], { cwd: fixture, encoding: 'utf8' });
      assert.notEqual(result.status, 0, `validator unexpectedly accepted ${injection}`);
      assert.match(result.stderr, /tracked public artifact must expose exactly the five approved Drive folder URLs/);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('private document renderer keeps public-risk notice, safe external-link attributes, and 44px targets', async () => {
  const fs = await import('node:fs/promises');
  const [source, styles, markup] = await Promise.all([
    fs.readFile(new URL('../app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /function renderPrivateDocuments\(\)/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  assert.match(source, /已獲授權的 Google 帳號登入/);
  assert.match(source, /請勿轉傳/);
  assert.match(source, /住宿資料夾可能含取消紀錄；請以最新 Notion／確認信為準/);
  assert.match(source, /私人文件捷徑暫時無法載入；原行程內容不受影響/);
  assert.match(markup, /data-view="documents">私人文件捷徑/);
  assert.match(markup, /styles\.css\?v=20260815-1/);
  assert.match(styles, /\.document-shortcut-card \.button-link \{ width: 100%/);
  assert.match(styles, /button, \.button-link \{[\s\S]*min-height: 44px/);
});

test('button system keeps every button variant in the orange palette with accessible states', async () => {
  const fs = await import('node:fs/promises');
  const [styles, markup] = await Promise.all([
    fs.readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(styles, /--button: #[0-9a-f]{6};/i);
  assert.match(styles, /--button-hover: #[0-9a-f]{6};/i);
  assert.match(styles, /--button-active: #[0-9a-f]{6};/i);
  assert.match(styles, /--button-danger: #[0-9a-f]{6};/i);
  assert.match(styles, /button, \.button-link \{[\s\S]*min-height: 44px;[\s\S]*border: 1px solid var\(--button\);[\s\S]*background: var\(--button\);/);
  assert.match(styles, /button:hover:not\(:disabled\), \.button-link:hover:not\(\[aria-disabled="true"\]\) \{ background: var\(--button-hover\); \}/);
  assert.match(styles, /button:active:not\(:disabled\), \.button-link:active:not\(\[aria-disabled="true"\]\) \{ background: var\(--button-active\); \}/);
  assert.match(styles, /\.primary-nav button \{[\s\S]*min-height: 44px;[\s\S]*color: #fff;[\s\S]*background: var\(--button\); \}/);
  assert.match(styles, /\.primary-nav button\[aria-current="page"\] \{[\s\S]*background: var\(--button-active\); \}/);
  assert.match(styles, /button:disabled, \.button-link\[aria-disabled="true"\] \{[\s\S]*cursor: not-allowed;[\s\S]*background: var\(--button-disabled\);/);
  assert.match(styles, /\.danger \{ border-color: var\(--button-danger\); background: var\(--button-danger\); \}/);
  assert.match(styles, /button:focus-visible, \.button-link:focus-visible, a:focus-visible/);
  assert.match(markup, /styles\.css\?v=20260815-1/);
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
  assert.deepEqual(config.locations[2], { date: '2026-08-15', locationLabel: '六本木（跨區日代表地區）', lat: 35.6604621, lng: 139.7292785 });
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
  assert.equal(navigation.length, 28);
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
  assert.match(itinerary.get('2026-08-15'), /森美術館.*Hender Scheme.*HANDS 澀谷店.*歌舞伎町 BON ODORI/s);
  assert.doesNotMatch(itinerary.get('2026-08-15'), /木更津|WACKO MARIA/);
  const august15 = trip.dailyPlans.find((day) => day.date === '2026-08-15');
  assert.equal(august15.highLevelItinerary.length, 4);
  assert.doesNotMatch(august15.highLevelItinerary.join('｜'), /\d{1,2}:\d{2}/);
  assert.match(august15.highLevelItinerary.join('｜'), /Uber 約 20–30 分鐘.*步行約 12–15 分鐘.*Uber 約 30–40 分鐘/s);
  assert.equal(august15.navigation.length, 4);
  assert.deepEqual(august15.navigation.map(({ label }) => label), [
    '森美術館｜六本木 Hills 森塔 53F',
    'Hender Scheme｜sukima 宮下公園',
    'HANDS 澀谷店',
    '歌舞伎町 BON ODORI｜新宿 Cinema City 廣場',
  ]);
  assert.match(itinerary.get('2026-08-17'), /八ッ場水壩/);
  assert.match(itinerary.get('2026-08-18'), /四萬甌穴群/);
  assert.match(itinerary.get('2026-08-19'), /奧四萬湖.*伊香保溫泉石段街.*碓冰峠眼鏡橋/s);
  assert.match(itinerary.get('2026-08-20'), /鬼押出園.*白絲瀑布.*Candle Night/s);
  const august22 = trip.dailyPlans.find((day) => day.date === '2026-08-22');
  assert.equal(august22.navigation.find((entry) => entry.label.includes('Ron Mueck')).state, 'candidate');
});

test('introduction quick navigation derives its exact count, order, hrefs, and candidate states from source items', async () => {
  const { default: introductions } = await import('../data/introductions.json', { with: { type: 'json' } });
  const entries = introductionQuickNavEntries(introductions.items);
  assert.equal(entries.length, 14);
  assert.deepEqual(entries.map((entry) => entry.id), introductions.items.map((item) => item.id));
  assert.deepEqual(entries.map((entry) => entry.href), introductions.items.map((item) => `#intro-${item.id}`));
  assert.ok(entries.every((entry) => entry.targetId === introductionTargetId(entry.id)));
  assert.deepEqual(entries.filter((entry) => entry.state === 'candidate').map((entry) => entry.id), introductions.items.filter((item) => item.state === 'candidate').map((item) => item.id));
});

test('daily itinerary introduction links resolve exact official items to safe in-page targets', async () => {
  const [{ default: introductions }, { default: trip }] = await Promise.all([
    import('../data/introductions.json', { with: { type: 'json' } }),
    import('../data/trip-data.json', { with: { type: 'json' } }),
  ]);
  const itemIds = new Set(introductions.items.map((item) => item.id));
  const officialItems = new Set(trip.dailyPlans.flatMap((day) => day.highLevelItinerary.map((label) => `${day.date}|${label}`)));
  assert.equal(introductions.dailyItineraryLinks.length, 27);
  assert.ok(introductions.dailyItineraryLinks.every((link) => itemIds.has(link.introductionId)));
  assert.ok(introductions.dailyItineraryLinks.every((link) => officialItems.has(`${link.date}|${link.label}`)));
  assert.equal(dailyIntroductionTargetId(introductions.dailyItineraryLinks, introductions.items, '2026-08-15', '森美術館｜Ron Mueck 展（第一站）'), 'intro-ron-mueck-mori-2026');
  assert.equal(dailyIntroductionTargetId(introductions.dailyItineraryLinks, introductions.items, '2026-08-15', 'Hender Scheme｜sukima 宮下公園（從森美術館 Uber 約 20–30 分鐘）'), 'intro-shibuya-design-stationery');
  assert.equal(dailyIntroductionTargetId(introductions.dailyItineraryLinks, introductions.items, '2026-08-15', 'HANDS 澀谷店｜大型文具（從宮下公園步行約 12–15 分鐘）'), 'intro-shibuya-design-stationery');
  assert.equal(dailyIntroductionTargetId(introductions.dailyItineraryLinks, introductions.items, '2026-08-15', '歌舞伎町 BON ODORI（從澀谷 Uber 約 30–40 分鐘）'), 'intro-kabukicho-bon-odori-2026');
  assert.equal(dailyIntroductionTargetId(introductions.dailyItineraryLinks, introductions.items, '2026-08-13', '抵達後前往千葉幕張並休息'), null);
  assert.equal(dailyIntroductionTargetId([{ date: '2026-08-15', label: '不存在的行程', introductionId: 'missing' }], introductions.items, '2026-08-15', '不存在的行程'), null);
});

test('daily itinerary renderer switches to the matching introduction with accessible 44px links', async () => {
  const fs = await import('node:fs/promises');
  const [source, styles, markup] = await Promise.all([
    fs.readFile(new URL('../app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /function dailyItineraryItem\(day, item\)/);
  assert.match(source, /data-daily-intro data-intro-target=/);
  assert.match(source, /window\.location\.hash = dailyIntroLink\.dataset\.introTarget/);
  assert.match(source, /switchView\('introductions', dailyIntroLink\)/);
  assert.match(source, /可點選有底線的景點與活動查看介紹/);
  assert.match(styles, /\.daily-intro-link \{[^}]*min-height: 44px/);
  assert.match(markup, /app\.js\?v=20260815-1/);
});

test('introduction renderer keeps one matching quick target and return anchor per source item', async () => {
  const [source, { default: introductions }] = await Promise.all([
    (await import('node:fs/promises')).readFile(new URL('../app.js', import.meta.url), 'utf8'),
    import('../data/introductions.json', { with: { type: 'json' } }),
  ]);
  assert.match(source, /function renderIntroductionQuickNav\(items\)/);
  assert.match(source, /introductionQuickNavEntries\(items\)/);
  assert.match(source, /id="intro-quick-nav"/);
  assert.match(source, /aria-labelledby="intro-quick-nav-heading"/);
  assert.match(source, /href="#intro-quick-nav" data-intro-return/);
  assert.match(source, /id="intro-\$\{escapeHtml\(item\.id\)\}" tabindex="-1"/);
  assert.match(source, /focusIntroductionHashTarget/);
  assert.match(source, /window\.addEventListener\('hashchange', handleIntroductionHashNavigation\)/);
  assert.match(source, /event\.target\.closest\('\[data-intro-target\], \[data-intro-return\]'\)/);
  assert.doesNotMatch(source, /introLink\.preventDefault/);
  assert.match(source, /introductions\.items\.some\(\(item\) => `intro-\$\{item\.id\}` === introductionHash\)/);
  assert.equal(introductionQuickNavEntries(introductions.items).filter((entry) => entry.href.startsWith('#intro-')).length, introductions.items.length);
});

test('introduction quick navigation CSS keeps focus, scroll margins, responsive wrapping, and 44px targets', async () => {
  const styles = await (await import('node:fs/promises')).readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.intro-quick-nav \{[^}]*scroll-margin-top:/);
  assert.match(styles, /\.intro-card \{ scroll-margin-top:/);
  assert.match(styles, /\.intro-card:focus, \.intro-quick-nav:focus \{ outline: 3px solid var\(--focus\)/);
  assert.match(styles, /\.intro-quick-nav-list a \{[^}]*min-height: 44px/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fit, minmax\(16rem, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.intro-quick-nav-list \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('introduction snapshot covers the trip with safe official HTTPS sources', async () => {
  const { default: introductions } = await import('../data/introductions.json', { with: { type: 'json' } });
  assert.ok(introductions.items.length >= 12);
  assert.ok(introductions.items.every((item) => item.features.length >= 3));
  assert.ok(introductions.items.every((item) => item.background && item.familyTip));
  assert.ok(introductions.items.flatMap((item) => item.sources).every((source) => source.url.startsWith('https://')));
  assert.equal(new Set(introductions.items.flatMap((item) => item.sources.map((source) => source.ref))).size, 21);
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
