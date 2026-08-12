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
  assert.equal(navigation.length, 17);
  assert.ok(navigation.every((entry) => hasValidMapLocation(entry.mapLocation)));
});

test('introduction snapshot covers the trip with safe official HTTPS sources', async () => {
  const { default: introductions } = await import('../data/introductions.json', { with: { type: 'json' } });
  assert.ok(introductions.items.length >= 8);
  assert.ok(introductions.items.every((item) => item.features.length >= 3));
  assert.ok(introductions.items.every((item) => item.background && item.familyTip));
  assert.ok(introductions.items.flatMap((item) => item.sources).every((source) => source.url.startsWith('https://')));
  assert.equal(new Set(introductions.items.flatMap((item) => item.sources.map((source) => source.ref))).size, 13);
});
