import test from 'node:test';
import assert from 'node:assert/strict';
import { stateLabel, isSafeMapsUrl, storageKey, saveId, hasValidMapLocation } from '../helpers.js';

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
