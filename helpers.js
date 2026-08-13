export const stateLabel = (state) => ({ confirmed: '已確認', candidate: '候選', backup: '備案', pending: '待確認' }[state] || '待確認');

export const isSafeMapsUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.google.com' && url.pathname.startsWith('/maps/');
  } catch { return false; }
};

export const APPROVED_DRIVE_FOLDER_URLS = Object.freeze([
  'https://drive.google.com/drive/folders/1Vb20JQC1-UUqdad0n9Qhlq1ydvM71nb5',
  'https://drive.google.com/drive/folders/1kNWR0Yuf2_wcqAFTK0HQESRdqdc-imKi',
  'https://drive.google.com/drive/folders/1yUYqMIAUxxuFFkgWNi-wN_ZFrrMe2AwB',
  'https://drive.google.com/drive/folders/1QA46EnxcPuEuy7RcNo0uw2wFLAJbZ-v4',
  'https://drive.google.com/drive/folders/1TzIF8enZ_mQ9TVQZGA2HGA-M-DA0ZRzQ',
]);
const APPROVED_DRIVE_FOLDER_URL_SET = new Set(APPROVED_DRIVE_FOLDER_URLS);

export const isSafeDriveFolderUrl = (value) => {
  try {
    const url = new URL(value);
    return typeof value === 'string' && url.href === value
      && url.protocol === 'https:' && url.hostname === 'drive.google.com'
      && !url.username && !url.password && !url.port
      && /^\/drive\/folders\/[A-Za-z0-9_-]+$/.test(url.pathname)
      && !url.search && !url.hash
      && APPROVED_DRIVE_FOLDER_URL_SET.has(value);
  } catch { return false; }
};

const hasExactKeys = (value, expected) => value && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === expected.length
  && expected.every((key) => Object.hasOwn(value, key));

export const hasValidPrivateDocumentShortcuts = (config) => Boolean(
  hasExactKeys(config, ['schemaVersion', 'shortcuts'])
  && config.schemaVersion === '1.0.0' && Array.isArray(config.shortcuts)
  && config.shortcuts.length === 5
  && new Set(config.shortcuts.map((shortcut) => shortcut?.url)).size === APPROVED_DRIVE_FOLDER_URLS.length
  && config.shortcuts.every((shortcut) => hasExactKeys(shortcut, ['label', 'description', 'url'])
    && typeof shortcut.label === 'string' && shortcut.label.trim()
    && typeof shortcut.description === 'string' && shortcut.description.trim()
    && isSafeDriveFolderUrl(shortcut.url)
    && APPROVED_DRIVE_FOLDER_URL_SET.has(shortcut.url))
);

export const storageKey = (section, id = '') => `ss-travel-console:v1:${section}${id ? `:${id}` : ''}`;

// Introduction navigation derives both its labels and stable native targets from one source array.
export const introductionTargetId = (id) => `intro-${id}`;
export const introductionQuickNavEntries = (items = []) => items.map((item) => ({
  id: item.id,
  targetId: introductionTargetId(item.id),
  href: `#${introductionTargetId(item.id)}`,
  title: item.title,
  state: item.state || null,
}));

export const hasValidMapLocation = (value) => Boolean(
  value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
  && value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180
);

// Snapshot labels and areas are read-only here, so this is a stable local-only pin key.
export const saveId = (save) => `${save.cityArea}|${save.label}`;

export const OPEN_METEO_FORECAST_ORIGIN = 'https://api.open-meteo.com';
export const OPEN_METEO_FORECAST_PATH = '/v1/forecast';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
];

export const isValidWeatherLocation = (location) => Boolean(
  location && typeof location.date === 'string' && ISO_DATE.test(location.date)
  && typeof location.locationLabel === 'string' && location.locationLabel.trim()
  && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90
  && Number.isFinite(location.lng) && location.lng >= -180 && location.lng <= 180
);

export const hasValidWeatherConfig = (config, expectedDates = []) => {
  if (!config || config.schemaVersion !== '1.0.0' || !Array.isArray(config.locations)) return false;
  const dates = config.locations.map((location) => location?.date);
  return config.locations.every(isValidWeatherLocation)
    && new Set(dates).size === dates.length
    && (!expectedDates.length || (dates.length === expectedDates.length && expectedDates.every((date) => dates.includes(date))));
};

export const buildOpenMeteoUrl = (location) => {
  if (!isValidWeatherLocation(location)) throw new TypeError('Invalid public weather location');
  const url = new URL(OPEN_METEO_FORECAST_PATH, OPEN_METEO_FORECAST_ORIGIN);
  url.search = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lng),
    daily: DAILY_FIELDS.join(','),
    timezone: 'Asia/Tokyo',
    start_date: location.date,
    end_date: location.date,
  }).toString();
  if (url.origin !== OPEN_METEO_FORECAST_ORIGIN || url.pathname !== OPEN_METEO_FORECAST_PATH || url.protocol !== 'https:') {
    throw new TypeError('Unsafe weather endpoint');
  }
  return url;
};

export class WeatherOutOfRangeError extends Error {
  constructor() { super('Selected date is outside the returned forecast range'); this.name = 'WeatherOutOfRangeError'; }
}

export const isOpenMeteoOutOfRangePayload = (payload) => Boolean(
  payload && payload.error === true && typeof payload.reason === 'string'
  && /out of allowed range/i.test(payload.reason)
);

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const validResponseDate = (value) => typeof value === 'string' && ISO_DATE.test(value);
const inRange = (value, minimum, maximum) => value >= minimum && value <= maximum;

// Broad Earth-weather sanity bounds: accept exceptional conditions, reject corrupt/extreme payloads.
const WEATHER_VALUE_BOUNDS = Object.freeze({
  temperatureC: Object.freeze([-100, 70]),
  precipitationProbability: Object.freeze([0, 100]),
  precipitationMm: Object.freeze([0, 2500]),
  windSpeedKmh: Object.freeze([0, 500]),
});

export const parseOpenMeteoDaily = (payload, expectedDate) => {
  if (!validResponseDate(expectedDate) || !payload || typeof payload !== 'object'
    || payload.timezone !== 'Asia/Tokyo' || !payload.daily || typeof payload.daily !== 'object') {
    throw new TypeError('Malformed weather response');
  }
  const { daily } = payload;
  if (!Array.isArray(daily.time) || !daily.time.length || !daily.time.every(validResponseDate)) throw new TypeError('Malformed weather dates');
  if (!DAILY_FIELDS.every((field) => Array.isArray(daily[field]) && daily[field].length === daily.time.length)) {
    throw new TypeError('Malformed weather daily fields');
  }
  if (!DAILY_FIELDS.every((field) => daily[field].every(finiteNumber))) throw new TypeError('Unsafe weather values');
  const index = daily.time.indexOf(expectedDate);
  if (index === -1) throw new WeatherOutOfRangeError();
  const result = {
    date: expectedDate,
    weatherCode: daily.weather_code[index],
    temperatureMax: daily.temperature_2m_max[index],
    temperatureMin: daily.temperature_2m_min[index],
    precipitationProbabilityMax: daily.precipitation_probability_max[index],
    precipitationSum: daily.precipitation_sum[index],
    windSpeedMax: daily.wind_speed_10m_max[index],
  };
  if (!Number.isInteger(result.weatherCode) || result.weatherCode < 0
    || !inRange(result.temperatureMin, ...WEATHER_VALUE_BOUNDS.temperatureC)
    || !inRange(result.temperatureMax, ...WEATHER_VALUE_BOUNDS.temperatureC)
    || result.temperatureMin > result.temperatureMax
    || !inRange(result.precipitationProbabilityMax, ...WEATHER_VALUE_BOUNDS.precipitationProbability)
    || !inRange(result.precipitationSum, ...WEATHER_VALUE_BOUNDS.precipitationMm)
    || !inRange(result.windSpeedMax, ...WEATHER_VALUE_BOUNDS.windSpeedKmh)) throw new TypeError('Unsafe weather values');
  return Object.freeze(result);
};

const WMO_WEATHER = {
  0: ['☀️', '晴朗'], 1: ['🌤️', '大致晴朗'], 2: ['⛅', '局部多雲'], 3: ['☁️', '陰天'],
  45: ['🌫️', '有霧'], 48: ['🌫️', '霧淞'],
  51: ['🌦️', '毛毛雨（弱）'], 53: ['🌦️', '毛毛雨（中）'], 55: ['🌧️', '毛毛雨（強）'],
  56: ['🌧️', '凍毛毛雨（弱）'], 57: ['🌧️', '凍毛毛雨（強）'],
  61: ['🌦️', '小雨'], 63: ['🌧️', '中雨'], 65: ['🌧️', '大雨'],
  66: ['🌧️', '凍雨（弱）'], 67: ['🌧️', '凍雨（強）'],
  71: ['🌨️', '小雪'], 73: ['🌨️', '中雪'], 75: ['❄️', '大雪'], 77: ['🌨️', '霰'],
  80: ['🌦️', '陣雨（弱）'], 81: ['🌧️', '陣雨（中）'], 82: ['⛈️', '陣雨（強）'],
  85: ['🌨️', '陣雪（弱）'], 86: ['❄️', '陣雪（強）'],
  95: ['⛈️', '雷雨'], 96: ['⛈️', '雷雨伴隨小冰雹'], 99: ['⛈️', '雷雨伴隨大冰雹'],
};

export const weatherCodeLabel = (code) => {
  const weather = WMO_WEATHER[code];
  return weather ? { icon: weather[0], description: weather[1] } : { icon: '❔', description: '天氣狀況待確認' };
};
