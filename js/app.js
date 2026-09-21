/*
 * app.js — 画面遷移（ハッシュルーティング）とイベント配線。
 * 各画面は render<Name>(root, params) を持ち、離れるときに cleanup を返す。
 */

import { store } from './store.js';
import * as M from './model.js';
import { search, debounce } from './geocode.js';
import { createMap } from './map.js';
import { processImage } from './photo.js';
import { root, h, toast, navigate, makeSaver } from './ui.js';
import { renderPrint } from './print-view.js';
import { renderSettings } from './settings-view.js';

let cleanup = null;

// ---- 旅一覧 ---------------------------------------------------------------

const isEmptyTrip = (t) => !t.title && !t.subtitle && t.visits.length === 0;

async function renderList() {
  // 「新しい旅」を押して何も入れずに戻った空の旅は残さない
  const all = await store.getAllTrips();
  for (const t of all.filter(isEmptyTrip)) await store.deleteTrip(t.id).catch(() => {});
  const trips = all.filter((t) => !isEmptyTrip(t));
  const list = h('ul', { class: 'trip-list' });
  if (trips.length === 0) {
    list.append(h('li', { class: 'empty' }, 'まだ旅がありません。「新しい旅」から始めてください。'));
  }
  for (const t of trips) {
    list.append(
      h('li', { class: 'trip-card' },
        h('a', { class: 'trip-card__main', href: `#/trip/${t.id}` },
          h('span', { class: 'trip-card__title' }, t.title || '（無題の旅）'),
          h('span', { class: 'trip-card__meta' }, `${M.formatDateRange(t.startDate, t.endDate)} · ${t.visits.length} 地点`),
        ),
        h('div', { class: 'trip-card__actions' },
          h('button', { class: 'btn btn--ghost btn--sm', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              // 写真も複製して独立させる（共有すると片方の削除でもう片方の写真が消える）
              const idMap = new Map();
              for (const pid of M.allPhotoIds(t)) {
                const p = await store.getPhoto(pid);
                if (!p) continue;
                const nid = M.uid();
                await store.putPhoto({ ...p, id: nid });
                idMap.set(pid, nid);
              }
              const remap = (ids) => ids.map((x) => idMap.get(x) ?? null);
              const slots = Object.fromEntries(Object.entries(t.slots || {}).map(([k, arr]) => [k, arr.map((x) => (x ? idMap.get(x) ?? null : x))]));
              const photoPos = Object.fromEntries(Object.entries(t.photoPos || {}).filter(([k]) => idMap.has(k)).map(([k, v]) => [idMap.get(k), v]));
              const copy = M.createTrip({ ...t, id: undefined, title: `${t.title} のコピー`, createdAt: undefined, updatedAt: undefined, slots, photoPos,
                visits: t.visits.map((v) => ({ ...v, id: M.uid(), photoIds: remap(v.photoIds).filter(Boolean) })) });
              await store.putTrip(copy);
            } catch (err) {
              toast(`複製できませんでした：${err.message}`, 'error');
            }
            renderList();
          } }, '複製'),
          h('button', { class: 'btn btn--ghost btn--sm btn--danger', onclick: async () => {
            if (!confirm(`「${t.title || '無題の旅'}」を削除します。写真も消えます。よろしいですか？`)) return;
            await store.deleteTrip(t.id);
            renderList();
          } }, '削除'),
        ),
      ),
    );
  }

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('h1', { class: 'topbar__title' }, '旅あと'),
      h('nav', { class: 'topbar__nav' },
        h('a', { class: 'btn btn--ghost', href: '#/settings' }, '設定'),
        h('button', { class: 'btn btn--primary', onclick: async () => {
          const trip = M.createTrip({ title: '' });
          await store.putTrip(trip);
          navigate(`#/trip/${trip.id}`);
        } }, '新しい旅'),
      ),
    ),
    h('main', { class: 'page' }, list),
  );
  return () => {};
}

// ---- 編集画面 -------------------------------------------------------------

const TRANSPORT_LABELS = { '': '未指定', walk: '徒歩', car: '車', train: '電車', bus: 'バス', plane: '飛行機', ship: '船' };

async function renderEdit({ id }) {
  let trip = await store.getTrip(id);
  if (!trip) {
    root.replaceChildren(h('main', { class: 'page' },
      h('p', { class: 'empty' }, 'この旅は見つかりません。一覧に戻って選び直してください。'),
      h('a', { class: 'btn', href: '#/' }, '一覧へ')));
    return () => {};
  }
  let activeId = null;
  let alive = true; // 画面離脱後の非同期処理（写真追加など）を止める
  const thumbs = new Map(); // photoId -> dataURL

  // -- ヘッダ
  const statusEl = h('span', { class: 'save-status' }, '保存済み');
  const save = makeSaver(statusEl, {
    baseUpdatedAt: trip.updatedAt,
    onConflict: (kind) => { alive = false; if (kind === 'deleted') navigate('#/'); else route(); },
  });
  const commit = (next) => { if (!alive) return; trip = next; save(trip); };

  const titleInput = h('input', { class: 'title-input', type: 'text', placeholder: '旅のタイトル', value: trip.title,
    oninput: (e) => commit(M.touch({ ...trip, title: e.target.value })) });
  const startInput = h('input', { type: 'date', value: trip.startDate, 'aria-label': '開始日',
    onchange: (e) => {
      if (!M.DATE_RE.test(e.target.value)) { e.target.value = trip.startDate; return; }
      const endDate = trip.endDate < e.target.value ? e.target.value : trip.endDate;
      endInput.value = endDate;
      commit(M.touch({ ...trip, startDate: e.target.value, endDate }));
    } });
  const endInput = h('input', { type: 'date', value: trip.endDate, 'aria-label': '終了日',
    onchange: (e) => {
      if (!M.DATE_RE.test(e.target.value)) { e.target.value = trip.endDate; return; }
      const endDate = e.target.value < trip.startDate ? trip.startDate : e.target.value;
      e.target.value = endDate;
      commit(M.touch({ ...trip, endDate }));
    } });

  // -- 検索
  const searchInput = h('input', { class: 'search-input', type: 'search', placeholder: '場所名で検索（例：清水寺）', autocomplete: 'off' });
  const results = h('ul', { class: 'search-results', hidden: true });
  const searchHint = h('p', { class: 'hint' }, '名前で出ない場所は、地図をクリックしてピンを置けます。');

  async function doSearch() {
    const q = searchInput.value.trim();
    if (!q) { results.hidden = true; return; }
    results.replaceChildren(h('li', { class: 'search-results__note' }, '検索中…'));
    results.hidden = false;
    try {
      const items = await search(q);
      if (searchInput.value.trim() !== q) return;
      results.replaceChildren();
      if (items.length === 0) {
        results.append(h('li', { class: 'search-results__note' }, '見つかりませんでした。別の言い方か、地図クリックで置いてください。'));
        return;
      }
      for (const it of items) {
        results.append(h('li', {},
          h('button', { class: 'search-results__item', type: 'button', onclick: () => {
            addVisitAt({ name: it.name, lat: it.lat, lng: it.lng });
            searchInput.value = '';
            results.hidden = true;
          } },
          h('span', { class: 'search-results__name' }, it.name),
          h('span', { class: 'search-results__addr' }, it.displayName),
          )));
      }
    } catch (e) {
      results.replaceChildren(h('li', { class: 'search-results__note search-results__note--error' }, e.message));
    }
  }
  const debouncedSearch = debounce(doSearch, 600);
  searchInput.addEventListener('input', debouncedSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); debouncedSearch.cancel(); doSearch(); } });

  // -- 訪問地リスト
  const listEl = h('ol', { class: 'visit-list' });

  function defaultDate() {
    const last = trip.visits[trip.visits.length - 1];
    return last ? last.date : trip.startDate;
  }

  function addVisitAt({ name, lat, lng }) {
    const v = M.createVisit({ name, lat, lng, date: defaultDate() });
    commit(M.addVisit(trip, v));
    activeId = v.id;
    renderVisits();
    map.setVisits(trip.visits);
    map.setActive(v.id, { pan: false });
    const nameInput = listEl.querySelector(`[data-id="${v.id}"] .visit__name`);
    if (nameInput && !name) nameInput.focus();
  }

  function refreshMap(fit) { map.setVisits(trip.visits, { fit }); map.setActive(activeId, { pan: false }); }

  async function addPhotos(visitId, files) {
    const errors = [];
    for (const f of files) {
      try {
        const photo = await processImage(f);
        if (!alive) return;
        await store.putPhoto(photo);
        if (!alive) { await store.deletePhoto(photo.id); return; }
        thumbs.set(photo.id, photo.thumb);
        const cur = trip.visits.find((x) => x.id === visitId);
        if (!cur) { await store.deletePhoto(photo.id); continue; }
        commit(M.updateVisit(trip, visitId, { photoIds: [...cur.photoIds, photo.id] }));
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!alive) return;
    if (errors.length) toast(errors.join('\n'), 'error');
    renderVisits();
  }

  async function removePhoto(visitId, photoId) {
    const cur = trip.visits.find((x) => x.id === visitId);
    if (!cur) return;
    commit(M.updateVisit(trip, visitId, { photoIds: cur.photoIds.filter((p) => p !== photoId) }));
    await store.deletePhoto(photoId);
    thumbs.delete(photoId);
    renderVisits();
  }

  async function loadThumbs(ids) {
    const missing = ids.filter((pid) => !thumbs.has(pid));
    if (!missing.length) return;
    await Promise.all(missing.map(async (pid) => {
      const p = await store.getPhoto(pid);
      thumbs.set(pid, p ? p.thumb : null);
    }));
  }

  // ドラッグ並び替え（番号バッジが持ち手）
  let dragId = null;
  let grabbed = false;

  function renderDetail(v) {
    const photoRow = h('div', { class: 'visit__photos' });
    for (const pid of v.photoIds) {
      const src = thumbs.get(pid);
      photoRow.append(h('figure', { class: 'thumb' },
        src ? h('img', { src, alt: '' }) : h('span', { class: 'thumb__missing' }, '写真なし'),
        h('button', { class: 'thumb__remove', type: 'button', title: '写真を外す', onclick: () => removePhoto(v.id, pid) }, '×')));
    }
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true,
      onchange: (e) => { addPhotos(v.id, [...e.target.files]); e.target.value = ''; } });
    photoRow.append(h('button', { class: 'thumb thumb--add', type: 'button', onclick: () => fileInput.click() }, '＋ 写真'), fileInput);

    const transportSel = h('select', { class: 'visit__transport', 'aria-label': '前の地点からの移動手段',
      onchange: (e) => { commit(M.updateVisit(trip, v.id, { transport: e.target.value || null })); refreshMap(false); } },
      ...Object.entries(TRANSPORT_LABELS).map(([val, label]) => h('option', { value: val, selected: (v.transport || '') === val }, label)));

    const comment = h('textarea', { class: 'visit__comment', rows: 2, maxlength: 120, placeholder: 'ひとこと（60字くらいまで）',
      oninput: (e) => commit(M.updateVisit(trip, v.id, { comment: e.target.value })) }, v.comment);

    return h('div', { class: 'visit__detail' },
      v.order > 0 ? h('label', { class: 'visit__field' }, h('span', {}, '前の地点から'), transportSel) : null,
      comment,
      photoRow,
    );
  }

  function renderVisits() {
    listEl.replaceChildren();
    if (trip.visits.length === 0) {
      listEl.append(h('li', { class: 'empty' }, '検索するか地図をクリックして、最初の訪問地を置いてください。'));
      return;
    }
    trip.visits.forEach((v, i) => {
      const active = v.id === activeId;
      const item = h('li', { class: 'visit' + (active ? ' visit--active' : ''), dataset: { id: v.id }, draggable: 'true',
        onclick: (e) => { if (e.target.closest('button,input,select,textarea,label')) return;
          activeId = active ? null : v.id; renderVisits(); if (activeId) map.setActive(v.id); else map.setActive(null, { pan: false }); },
        ondragstart: (e) => { if (!grabbed) { e.preventDefault(); return; } dragId = v.id; e.dataTransfer.effectAllowed = 'move'; item.classList.add('visit--dragging'); },
        ondragend: () => { grabbed = false; dragId = null; listEl.querySelectorAll('.visit--over').forEach((x) => x.classList.remove('visit--over')); },
        ondragover: (e) => { if (!dragId || dragId === v.id) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; item.classList.add('visit--over'); },
        ondragleave: () => item.classList.remove('visit--over'),
        ondrop: (e) => { e.preventDefault(); if (!dragId || dragId === v.id) return;
          commit(M.moveVisit(trip, dragId, i)); renderVisits(); refreshMap(false); },
      },
        h('span', { class: 'visit__no', title: 'ドラッグで並び替え', onpointerdown: () => { grabbed = true; },
          onpointerup: () => { grabbed = false; }, onpointercancel: () => { grabbed = false; } }, String(i + 1)),
        h('div', { class: 'visit__body' },
          h('input', { class: 'visit__name', type: 'text', value: v.name, placeholder: '場所の名前', 'aria-label': '場所の名前',
            oninput: (e) => commit(M.updateVisit(trip, v.id, { name: e.target.value })) }),
          h('div', { class: 'visit__meta' },
            h('input', { class: 'visit__date', type: 'date', value: v.date, 'aria-label': '日付',
              onchange: (e) => { if (M.DATE_RE.test(e.target.value)) commit(M.updateVisit(trip, v.id, { date: e.target.value })); } }),
            v.photoIds.length ? h('span', { class: 'visit__badge' }, `写真 ${v.photoIds.length}`) : null,
          ),
          active ? renderDetail(v) : null,
        ),
        h('div', { class: 'visit__actions' },
          h('button', { class: 'btn btn--icon', type: 'button', title: '上へ', disabled: i === 0,
            onclick: () => { commit(M.moveVisit(trip, v.id, i - 1)); renderVisits(); refreshMap(false); } }, '▲'),
          h('button', { class: 'btn btn--icon', type: 'button', title: '下へ', disabled: i === trip.visits.length - 1,
            onclick: () => { commit(M.moveVisit(trip, v.id, i + 1)); renderVisits(); refreshMap(false); } }, '▼'),
          h('button', { class: 'btn btn--icon btn--danger', type: 'button', title: '削除',
            onclick: async () => {
              if (v.photoIds.length && !confirm(`「${v.name || '無題'}」を削除します。写真 ${v.photoIds.length} 枚も消えます。よろしいですか？`)) return;
              for (const pid of v.photoIds) await store.deletePhoto(pid);
              commit(M.removeVisit(trip, v.id)); if (activeId === v.id) activeId = null; renderVisits(); refreshMap(true); } }, '×'),
        ),
      );
      listEl.append(item);
    });
    const act = trip.visits.find((x) => x.id === activeId);
    if (act && act.photoIds.some((pid) => !thumbs.has(pid))) loadThumbs(act.photoIds).then(renderVisits);
  }

  // -- 地図
  const mapEl = h('div', { class: 'map', id: 'map' });
  const styleBtns = {};
  const styleCtl = h('div', { class: 'map-style' },
    ...[['positron', '淡色'], ['osm', '標準']].map(([val, label]) =>
      (styleBtns[val] = h('button', { class: 'map-style__btn', type: 'button', 'aria-pressed': String(trip.mapStyle === val),
        onclick: () => { commit(M.touch({ ...trip, mapStyle: val })); map.setStyle(val);
          for (const [k, b] of Object.entries(styleBtns)) b.setAttribute('aria-pressed', String(k === val)); } }, label))));

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('a', { class: 'btn btn--ghost', href: '#/' }, '← 一覧'),
      h('div', { class: 'topbar__trip' }, titleInput,
        h('div', { class: 'date-range' }, startInput, h('span', {}, '〜'), endInput)),
      h('nav', { class: 'topbar__nav' },
        statusEl,
        h('a', { class: 'btn btn--primary', href: `#/print/${trip.id}` }, 'A4 プレビュー'),
      ),
    ),
    h('main', { class: 'workbench' },
      h('section', { class: 'panel' },
        h('div', { class: 'search' }, searchInput, results, searchHint),
        listEl,
      ),
      h('section', { class: 'map-pane' }, mapEl, styleCtl),
    ),
  );

  const map = createMap(mapEl, {
    style: trip.mapStyle,
    onClick: ({ lat, lng }) => addVisitAt({ name: '', lat, lng }),
    onMarkerClick: (vid) => { activeId = vid; renderVisits(); map.setActive(vid, { pan: false });
      listEl.querySelector(`[data-id="${vid}"]`)?.scrollIntoView({ block: 'nearest' }); },
  });
  renderVisits();
  map.setVisits(trip.visits);

  document.addEventListener('click', closeResults);
  function closeResults(e) { if (!e.target.closest('.search')) results.hidden = true; }

  return () => {
    alive = false;
    document.removeEventListener('click', closeResults);
    map.destroy();
  };
}

// ---- ルーター -------------------------------------------------------------

const routes = [
  { re: /^#\/?$/, view: () => renderList() },
  { re: /^#\/trip\/([^/]+)$/, view: (m) => renderEdit({ id: m[1] }) },
  { re: /^#\/print\/([^/]+)$/, view: (m) => renderPrint({ id: m[1] }) },
  { re: /^#\/settings$/, view: () => renderSettings() },
];

let routeSeq = 0;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const seq = ++routeSeq;
  if (typeof L === 'undefined') {
    root.replaceChildren(h('main', { class: 'page' },
      h('p', { class: 'empty' }, '地図ライブラリを読み込めませんでした。ネットワーク接続を確認して、ページを再読み込みしてください。')));
    return;
  }
  if (!root.hasChildNodes()) root.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'empty' }, '読み込み中…')));
  const hash = location.hash || '#/';
  const r = routes.find((x) => x.re.test(hash));
  if (!r) { navigate('#/'); return; }
  try {
    const c = await r.view(hash.match(r.re));
    if (seq !== routeSeq) { if (c) c(); return; } // 遷移が追い越された：古い画面は即後始末
    cleanup = c;
  } catch (e) {
    if (seq !== routeSeq) return;
    root.replaceChildren(h('main', { class: 'page' },
      h('p', { class: 'empty' }, `画面を表示できませんでした：${e.message}。ページを再読み込みしてください。`)));
    console.error(e);
  }
}

window.addEventListener('hashchange', route);
route();
