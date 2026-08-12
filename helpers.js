export const stateLabel = (state) => ({ confirmed: '已確認', candidate: '候選', backup: '備案', pending: '待確認' }[state] || '待確認');

export const isSafeMapsUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.google.com' && url.pathname.startsWith('/maps/');
  } catch { return false; }
};

export const storageKey = (section, id = '') => `ss-travel-console:v1:${section}${id ? `:${id}` : ''}`;

export const hasValidMapLocation = (value) => Boolean(
  value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
  && value.lat >= -90 && value.lat <= 90 && value.lng >= -180 && value.lng <= 180
);

// Snapshot labels and areas are read-only here, so this is a stable local-only pin key.
export const saveId = (save) => `${save.cityArea}|${save.label}`;
