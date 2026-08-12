import { isSafeMapsUrl, stateLabel, storageKey, saveId, hasValidMapLocation } from './helpers.js?v=20260812-4';

const app = document.querySelector('#app-content');
const errorPanel = document.querySelector('#app-error');
const retryButton = document.querySelector('#retry-data');
const resetDialog = document.querySelector('#reset-dialog');
const storageNotice = document.querySelector('#storage-notice');
const nav = document.querySelector('.primary-nav');
let tripData;
let introductionData;
let storageAvailable = true;
let activeView = new URLSearchParams(window.location.search).get('view') || readLocal('view') || 'overview';
let selectedDate = readLocal('date');
let lastTrigger;

function readLocal(section, id) {
  try { return localStorage.getItem(storageKey(section, id)); }
  catch { storageAvailable = false; return null; }
}
function writeLocal(section, value, id) {
  try { localStorage.setItem(storageKey(section, id), value); }
  catch { storageAvailable = false; showStorageNotice(); }
}
function removeLocal(section, id) {
  try { localStorage.removeItem(storageKey(section, id)); }
  catch { storageAvailable = false; showStorageNotice(); }
}
function showStorageNotice() {
  if (!storageAvailable) {
    storageNotice.textContent = '本機勾選不會在重新整理後保留。';
    storageNotice.classList.remove('hidden');
  }
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function status(state) { return `<span class="status status-${escapeHtml(state)}">${stateLabel(state)}</span>`; }
function formatDate(date) {
  return new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(`${date}T00:00:00+09:00`));
}
function getDay() { return tripData.dailyPlans.find((day) => day.date === selectedDate) || tripData.dailyPlans[0]; }
function mapsAction(link) {
  if (!isSafeMapsUrl(link.mapsUrl)) return `<p class="source">此導航連結暫時不可用</p>`;
  return `<a class="button-link" href="${escapeHtml(link.mapsUrl)}" target="_blank" rel="noopener noreferrer">開啟導航<span class="sr-only">：${escapeHtml(link.label)}</span></a>`;
}
function sourceLine(source) { return `<p class="source">來源：${escapeHtml(source)}</p>`; }
function heading(title, description = '') { return `<header><h2 id="view-title" tabindex="-1">${title}</h2>${description ? `<p class="muted">${description}</p>` : ''}</header>`; }

function renderOverview() {
  const today = new Date().toISOString().slice(0, 10);
  const next = tripData.dailyPlans.find((day) => day.date >= today) || tripData.dailyPlans[0];
  const count = (state) => tripData.dailyPlans.filter((day) => day.state === state).length;
  const pending = tripData.checklist.filter((item) => !isChecklistDone(item)).length;
  return `<section class="view" aria-labelledby="view-title">${heading('總覽', '以已確認、候選、備案與待確認清楚區分；所有內容均為公開唯讀參考。')}
    <div class="grid three">
      <article class="card"><h3>旅行期間</h3><p>${formatDate(tripData.trip.dateRange.start)} 至 ${formatDate(tripData.trip.dateRange.end)}</p><p>${escapeHtml(tripData.trip.country)}</p></article>
      <article class="card"><h3>下一個行程日</h3><p><strong>${formatDate(next.date)}</strong></p><p>${escapeHtml(next.cityArea)}</p>${status(next.state)}</article>
      <article class="card"><h3>待確認事項</h3><p><strong>${pending}</strong> 項仍待處理</p><button type="button" data-go="checklist">查看出發清單</button></article>
    </div>
    <section class="card"><h3>行程路線</h3><ol class="route">${tripData.dailyPlans.map((day) => `<li><strong>${formatDate(day.date)}</strong>｜${escapeHtml(day.cityArea)} ${status(day.state)}</li>`).join('')}</ol></section>
    <section class="card"><h3>狀態摘要</h3><p>${status('confirmed')} ${count('confirmed')} 天　${status('candidate')} 導航與活動依條件調整　${status('backup')} 僅作備用　${status('pending')} ${pending} 項待確認</p></section>
  </section>`;
}
function dayPicker() {
  return `<label>選擇日期 <select id="day-picker" aria-label="選擇行程日期">${tripData.dailyPlans.map((day) => `<option value="${day.date}" ${day.date === selectedDate ? 'selected' : ''}>${formatDate(day.date)}｜${escapeHtml(day.cityArea)}</option>`).join('')}</select></label>`;
}
function renderDaily() {
  const day = getDay(); const index = tripData.dailyPlans.indexOf(day);
  const links = day.navigation.length ? day.navigation.map((link) => `<li class="card"><h3>${escapeHtml(link.label)} ${status(link.state)}</h3>${mapsAction(link)}${sourceLine(link.source)}</li>`).join('') : '<p class="empty">此日尚無儲存的公開導航連結</p>';
  return `<section class="view" aria-labelledby="view-title">${heading('每日行程', '日期選擇會在本裝置瀏覽器中保留。')}
    <div class="day-nav">${dayPicker()}<button type="button" data-day="${index - 1}" ${index === 0 ? 'disabled' : ''}>前一天</button><button type="button" data-day="${index + 1}" ${index === tripData.dailyPlans.length - 1 ? 'disabled' : ''}>下一天</button></div>
    <article class="card"><p><strong>${formatDate(day.date)}</strong>｜${escapeHtml(day.cityArea)} ${status(day.state)}</p><ul class="list">${day.highLevelItinerary.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${sourceLine(day.source)}</article>
    <h3>公開導航</h3><ul class="route">${links}</ul>
  </section>`;
}
function introductionSourceLinks(sources) {
  return `<ul class="source-links">${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">[${escapeHtml(source.ref)}] ${escapeHtml(source.title)}<span class="sr-only">（在新分頁開啟）</span></a></li>`).join('')}</ul>`;
}
function introductionPhoto(photo) {
  if (!photo) return '';
  return `<figure class="intro-photo">
    <img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt)}" loading="lazy" decoding="async" width="1280" height="720">
    <div class="intro-photo-fallback" hidden role="status">照片暫時無法載入；請參考下方行程介紹與來源資訊。</div>
    <figcaption>${escapeHtml(photo.caption)}<span class="photo-credit">照片：${escapeHtml(photo.creator)}，${escapeHtml(photo.license)}｜<a href="${escapeHtml(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">授權條款<span class="sr-only">（在新分頁開啟）</span></a>｜<a href="${escapeHtml(photo.sourceUrl)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons 來源<span class="sr-only">（在新分頁開啟）</span></a></span></figcaption>
  </figure>`;
}
function renderIntroductions() {
  const items = introductionData?.items || [];
  const cards = items.map((item) => `<article class="card intro-card" id="intro-${escapeHtml(item.id)}">
    <div class="intro-meta"><span class="intro-category">${escapeHtml(item.category)}</span><span>${escapeHtml(item.area)}</span>${item.state ? status(item.state) : ''}</div>
    ${introductionPhoto(item.photo)}
    <h3>${escapeHtml(item.title)}</h3>
    <p class="intro-dates">${item.dates.length ? `對應行程：${item.dates.map(formatDate).join('、')}` : '對應行程：日期尚未分配'}</p>
    <p class="intro-summary">${escapeHtml(item.summary)} ${item.sources.map((source) => `<a class="citation" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" aria-label="官方來源 ${escapeHtml(source.ref)}">[${escapeHtml(source.ref)}]</a>`).join('')}</p>
    <div class="intro-sections">
      <section><h4>特色</h4><ul class="list">${item.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></section>
      <section><h4>歷史與背景</h4><p>${escapeHtml(item.background)}</p></section>
      <section class="family-tip"><h4>家庭看點</h4><p>${escapeHtml(item.familyTip)}</p></section>
    </div>
    <details><summary>查看官方來源</summary>${introductionSourceLinks(item.sources)}</details>
  </article>`).join('');
  return `<section class="view" aria-labelledby="view-title">${heading('行程介紹', '把想去的地點放回特色、歷史與家庭旅行脈絡；內容依官方公開資料整理。')}
    <aside class="notice intro-note"><strong>閱讀方式：</strong>${escapeHtml(introductionData?.note || '營業與活動資訊請以出發前官方公告為準。')}</aside>
    <div class="intro-grid">${cards || '<p class="empty">目前沒有行程介紹</p>'}</div>
  </section>`;
}
function allNavigation() { return tripData.dailyPlans.flatMap((day) => day.navigation.map((link) => ({ ...link, date: day.date, cityArea: day.cityArea }))); }
function renderLinks() {
  return `<section class="view" aria-labelledby="view-title">${heading('旅程連結', '只會在新分頁開啟公開 Google Maps 搜尋或導航；不會送出任何行程資料。')}
    <div class="filter-row"><input id="link-filter" type="search" placeholder="搜尋日期、地區或地點" aria-label="搜尋旅程連結"><p id="link-count" class="muted"></p></div>
    <div id="links-list">${linkCards(allNavigation())}</div></section>`;
}
function linkCards(links) {
  if (!links.length) return '<p class="empty">沒有符合條件的公開導航連結</p>';
  return `<ul class="route">${links.map((link) => `<li class="card"><p><strong>${formatDate(link.date)}</strong>｜${escapeHtml(link.cityArea)}</p><h3>${escapeHtml(link.label)} ${status(link.state)}</h3>${mapsAction(link)}${sourceLine(link.source)}</li>`).join('')}</ul>`;
}
function mapPopup(entry) {
  return `<div class="map-popup"><p class="map-popup-date">${escapeHtml(formatDate(entry.date))}｜${escapeHtml(entry.cityArea)}</p><h3>${escapeHtml(entry.label)}</h3><p>${status(entry.state)}</p>${mapsAction(entry)}<p class="map-popup-note">此點僅供位置理解；${entry.state === 'confirmed' ? '仍請以出發前資訊為準。' : '非最終行程。'}</p></div>`;
}
function mapMarkerClass(state) { return `map-marker-${state}`; }
function mapMarkerIcon(state) {
  return window.L.divIcon({
    className: 'map-marker-wrapper',
    html: `<span class="map-marker ${mapMarkerClass(state)}" aria-hidden="true"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
}
function mapLegend() {
  return `<ul class="map-legend" aria-label="地標狀態圖例">${['confirmed', 'candidate', 'backup', 'pending'].map((state) => `<li><span class="map-marker ${mapMarkerClass(state)}" aria-hidden="true"></span>${stateLabel(state)}</li>`).join('')}</ul>`;
}
function renderMap() {
  const entries = allNavigation();
  const mappedEntries = entries.filter((entry) => hasValidMapLocation(entry.mapLocation));
  const mapStatus = mappedEntries.length === entries.length
    ? `共有 ${entries.length} 個可點擊地標；點擊可看日期、狀態與公開導航。`
    : `已有 ${mappedEntries.length} / ${entries.length} 個景點可顯示在地圖；其餘保留於下方文字路線。`;
  return `<section class="view" aria-labelledby="view-title">${heading('地圖', '地圖只供位置理解；不提供即時路況、天氣、路線保證或內嵌導航。')}
    <section class="map-card card" aria-labelledby="map-heading"><div class="map-heading"><div><h3 id="map-heading">景點地圖</h3><p id="map-status" class="muted">${mapStatus}</p></div>${mapLegend()}</div>
      <div id="trip-map" class="trip-map" role="region" aria-label="包含 ${mappedEntries.length} 個可點擊景點的互動地圖" aria-describedby="map-status"></div>
      <p id="map-fallback-notice" class="map-fallback-notice hidden" role="status">互動地圖暫時不可用；請使用下方依日期排序的文字路線與公開導航。</p>
    </section>
    <section class="card" aria-labelledby="map-list-heading"><h3 id="map-list-heading">路線清單（文字 fallback）</h3><p class="muted">即使地圖服務無法載入，仍可依下列順序使用公開導航連結。</p><ol class="route">${entries.map((entry) => `<li><strong>${formatDate(entry.date)}</strong>｜${escapeHtml(entry.cityArea)} → ${escapeHtml(entry.label)} ${status(entry.state)} ${mapsAction(entry)}</li>`).join('')}</ol></section>
  </section>`;
}
function markerPosition(entry, index, entries) {
  const samePlace = entries.filter((item) => item.mapLocation.lat === entry.mapLocation.lat && item.mapLocation.lng === entry.mapLocation.lng);
  if (samePlace.length === 1) return [entry.mapLocation.lat, entry.mapLocation.lng];
  const offsetIndex = samePlace.indexOf(entry) - ((samePlace.length - 1) / 2);
  // Separate same-place route and attraction markers so every marker remains selectable.
  return [entry.mapLocation.lat + (offsetIndex * 0.004), entry.mapLocation.lng + (offsetIndex * 0.004)];
}
function initMap() {
  const target = document.querySelector('#trip-map');
  const fallback = document.querySelector('#map-fallback-notice');
  if (!target) return;
  const entries = allNavigation().filter((entry) => hasValidMapLocation(entry.mapLocation));
  if (!window.L || !entries.length) {
    target.hidden = true;
    fallback?.classList.remove('hidden');
    return;
  }
  try {
    const map = window.L.map(target, { scrollWheelZoom: false, preferCanvas: true });
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    }).addTo(map);
    const markers = entries.map((entry, index) => {
      const marker = window.L.marker(markerPosition(entry, index, entries), { icon: mapMarkerIcon(entry.state), title: `${entry.label}｜${stateLabel(entry.state)}` });
      marker.bindPopup(mapPopup(entry), { maxWidth: 280, autoPanPadding: [24, 24] });
      marker.addTo(map);
      return marker;
    });
    map.fitBounds(window.L.featureGroup(markers).getBounds().pad(0.12), { maxZoom: 8 });
    window.setTimeout(() => map.invalidateSize(), 0);
  } catch (error) {
    console.error('互動地圖載入失敗', error);
    target.hidden = true;
    fallback?.classList.remove('hidden');
  }
}
function renderSaves() {
  const groups = tripData.saves.reduce((result, save) => {
    (result[save.cityArea] ||= []).push(save);
    return result;
  }, {});
  const cards = Object.entries(groups).map(([area, saves]) => `<article class="card"><h3>${escapeHtml(area)}</h3>${saves.map((save) => { const id = saveId(save); return `<div><p><strong>${escapeHtml(save.label)}</strong> ${status(save.state)}</p>${sourceLine(save.source)}<button type="button" data-pin="${escapeHtml(id)}">${isPinned(id) ? '取消本機收藏' : '本機收藏'}</button></div>`; }).join('')}</article>`).join('');
  return `<section class="view" aria-labelledby="view-title">${heading('收藏', '這些是選用想法與備案，不會轉為已確認行程。')}${cards || '<p class="empty">目前沒有備選收藏</p>'}</section>`;
}
function checklistId(item) { return `${item.label}|${item.dateContext}`; }
function isChecklistDone(item) { return readLocal('checklist', checklistId(item)) === 'done'; }
function isPinned(id) { return readLocal('pin', id) === 'true'; }
function renderChecklist() {
  const items = tripData.checklist; const open = items.filter((item) => !isChecklistDone(item)).length;
  return `<section class="view" aria-labelledby="view-title">${heading('出發清單', `尚有 ${open} 項待確認；勾選只儲存在本裝置。`)}
  <div class="actions"><label>顯示 <select id="check-filter"><option value="all">全部</option><option value="open">未完成</option><option value="done">已完成</option></select></label><button type="button" id="export-state">匯出本機狀態</button><button type="button" id="open-reset">清除本機狀態</button></div>
  <ul id="checklist-items" class="route">${checklistCards(items)}</ul></section>`;
}
function checklistCards(items) {
  if (!items.length) return '<li class="empty">目前沒有待確認項目</li>';
  return items.map((item) => { const done = isChecklistDone(item); const id = checklistId(item); return `<li class="card check-item" data-done="${done}"><input type="checkbox" id="check-${escapeHtml(id)}" data-check="${escapeHtml(id)}" ${done ? 'checked' : ''}><label for="check-${escapeHtml(id)}" class="${done ? 'completed' : ''}"><strong>${escapeHtml(item.label)}</strong> ${status(item.state)}<br><span>${escapeHtml(item.dateContext)}</span>${sourceLine(item.source)}</label></li>`; }).join('');
}
function render() {
  if (!tripData) return;
  if (!selectedDate || !tripData.dailyPlans.some((day) => day.date === selectedDate)) selectedDate = tripData.dailyPlans[0].date;
  const renderers = { overview: renderOverview, daily: renderDaily, introductions: renderIntroductions, links: renderLinks, map: renderMap, saves: renderSaves, checklist: renderChecklist };
  if (!renderers[activeView]) activeView = 'overview';
  app.innerHTML = renderers[activeView]();
  nav.querySelectorAll('button').forEach((button) => button.setAttribute('aria-current', button.dataset.view === activeView ? 'page' : 'false'));
  const title = app.querySelector('h2'); if (title) title.focus();
  showStorageNotice();
  if (activeView === 'links') updateLinkCount(allNavigation());
  if (activeView === 'map') initMap();
}
function updateLinkCount(links) { const count = document.querySelector('#link-count'); if (count) count.textContent = `共 ${links.length} 個公開導航連結`; }
function switchView(view, trigger) { activeView = view; lastTrigger = trigger; writeLocal('view', view); render(); }
function exportState() {
  const state = { version: 1, checklist: tripData.checklist.filter(isChecklistDone).map(checklistId), pins: tripData.saves.filter((save) => isPinned(saveId(save))).map(saveId) };
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'ss-travel-console-local-state.json'; link.click(); URL.revokeObjectURL(url);
}
function clearLocalState() {
  try { Object.keys(localStorage).filter((key) => key.startsWith('ss-travel-console:v1:')).forEach((key) => localStorage.removeItem(key)); }
  catch { storageAvailable = false; showStorageNotice(); }
  activeView = 'overview'; selectedDate = tripData.dailyPlans[0].date; render();
}

nav.addEventListener('click', (event) => { const button = event.target.closest('[data-view]'); if (button) switchView(button.dataset.view, button); });
app.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.closest('.intro-photo')) return;
  const figure = image.closest('.intro-photo');
  image.hidden = true;
  figure.querySelector('.intro-photo-fallback')?.removeAttribute('hidden');
}, true);
app.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]'); if (go) return switchView(go.dataset.go, go);
  const dayButton = event.target.closest('[data-day]'); if (dayButton) { const day = tripData.dailyPlans[Number(dayButton.dataset.day)]; if (day) { selectedDate = day.date; writeLocal('date', selectedDate); render(); } return; }
  const pin = event.target.closest('[data-pin]'); if (pin) { const value = pin.dataset.pin; isPinned(value) ? removeLocal('pin', value) : writeLocal('pin', 'true', value); render(); return; }
  if (event.target.id === 'open-reset') { lastTrigger = event.target; resetDialog.showModal(); }
  if (event.target.id === 'export-state') exportState();
});
app.addEventListener('change', (event) => {
  if (event.target.id === 'day-picker') { selectedDate = event.target.value; writeLocal('date', selectedDate); render(); }
  if (event.target.matches('[data-check]')) { event.target.checked ? writeLocal('checklist', 'done', event.target.dataset.check) : removeLocal('checklist', event.target.dataset.check); render(); }
  if (event.target.id === 'check-filter') document.querySelectorAll('#checklist-items [data-done]').forEach((node) => { node.hidden = event.target.value !== 'all' && node.dataset.done !== String(event.target.value === 'done'); });
});
app.addEventListener('input', (event) => { if (event.target.id === 'link-filter') { const query = event.target.value.toLowerCase(); const links = allNavigation().filter((link) => `${link.date} ${link.cityArea} ${link.label} ${stateLabel(link.state)}`.toLowerCase().includes(query)); document.querySelector('#links-list').innerHTML = linkCards(links); updateLinkCount(links); } });
resetDialog.addEventListener('close', () => { if (resetDialog.returnValue === 'confirm') clearLocalState(); else lastTrigger?.focus(); });
retryButton.addEventListener('click', () => loadData());
async function loadData() {
  errorPanel.classList.add('hidden');
  try {
    const [tripResponse, introResponse] = await Promise.all([
      fetch('./data/trip-data.json', { cache: 'no-store' }),
      fetch('./data/introductions.json', { cache: 'no-store' })
    ]);
    if (!tripResponse.ok || !introResponse.ok) throw new Error('data request failed');
    const [data, introductions] = await Promise.all([tripResponse.json(), introResponse.json()]);
    if (!Array.isArray(data.dailyPlans) || !data.trip || !Array.isArray(introductions.items)) throw new Error('invalid data');
    tripData = data;
    introductionData = introductions;
    document.querySelector('#app-title').textContent = data.trip.title;
    document.querySelector('#trip-range').textContent = `${formatDate(data.trip.dateRange.start)} 至 ${formatDate(data.trip.dateRange.end)}｜公開唯讀參考`;
    render();
  }
  catch (error) { console.error('旅程資料載入失敗', error); app.innerHTML = ''; errorPanel.classList.remove('hidden'); }
}
if (typeof document !== 'undefined') loadData();
