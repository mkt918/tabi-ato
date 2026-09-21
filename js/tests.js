/*
 * tests.js — model / store（/ templates）の自己検証。tests.html から読む。
 * IndexedDB を使うので Node では走らない。テスト用 DB は 'tabi-ato-test'。
 */

import * as M from './model.js';
import { createStore, EXPORT_VERSION } from './store.js';
import { TEMPLATE_LIST, getTemplate, buildSheet } from './templates.js';

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, detail: e && e.message ? e.message : String(e) });
  }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg ? msg + ': ' : ''}expected ${y} but got ${x}`);
}
async function rejects(p, msg) {
  let threw = false;
  try { await p; } catch { threw = true; }
  if (!threw) throw new Error(msg || 'expected rejection');
}

const v = (o) => M.createVisit({ lat: 35, lng: 135, date: '2026-01-01', ...o });

export async function run() {
  // ---- model -------------------------------------------------------------
  await test('createTrip: 既定値と visits の order 振り直し', () => {
    const t = M.createTrip({ visits: [v({ id: 'a', order: 5 }), v({ id: 'b', order: 2 })] });
    eq(t.visits.map((x) => [x.id, x.order]), [['b', 0], ['a', 1]]);
    assert(t.templateId === 'map-hero' && t.mapStyle === 'positron');
  });
  await test('addVisit: 末尾に追加され order が 0..n-1', () => {
    let t = M.createTrip();
    t = M.addVisit(t, v({ id: 'a' }));
    t = M.addVisit(t, v({ id: 'b' }));
    eq(t.visits.map((x) => x.order), [0, 1]);
    assert(t.visits[1].id === 'b');
  });
  await test('removeVisit: 削除後に order が詰まる', () => {
    let t = M.createTrip({ visits: [v({ id: 'a' }), v({ id: 'b', order: 1 }), v({ id: 'c', order: 2 })] });
    t = M.removeVisit(t, 'b');
    eq(t.visits.map((x) => [x.id, x.order]), [['a', 0], ['c', 1]]);
  });
  await test('moveVisit: 先頭を末尾へ／範囲外は端に収まる', () => {
    let t = M.createTrip({ visits: [v({ id: 'a' }), v({ id: 'b', order: 1 }), v({ id: 'c', order: 2 })] });
    t = M.moveVisit(t, 'a', 2);
    eq(t.visits.map((x) => x.id), ['b', 'c', 'a']);
    t = M.moveVisit(t, 'a', -5);
    eq(t.visits.map((x) => x.id), ['a', 'b', 'c']);
    eq(t.visits.map((x) => x.order), [0, 1, 2]);
  });
  await test('updateVisit: id は上書きされない・引数は不変', () => {
    const t0 = M.createTrip({ visits: [v({ id: 'a', name: 'x' })] });
    const t1 = M.updateVisit(t0, 'a', { name: 'y', id: 'zzz' });
    assert(t1.visits[0].id === 'a' && t1.visits[0].name === 'y');
    assert(t0.visits[0].name === 'x', '元が変わっている');
  });
  await test('sortByDate: 日付昇順・同日は order 順', () => {
    const list = [v({ id: 'a', date: '2026-01-02', order: 0 }), v({ id: 'b', date: '2026-01-01', order: 1 }), v({ id: 'c', date: '2026-01-01', order: 2 })];
    eq(M.sortByDate(list).map((x) => x.id), ['b', 'c', 'a']);
  });
  await test('groupByDate: 日別にまとまる', () => {
    const list = [v({ id: 'a', date: '2026-01-02', order: 0 }), v({ id: 'b', date: '2026-01-01', order: 1 }), v({ id: 'c', date: '2026-01-02', order: 2 })];
    const g = M.groupByDate(list);
    eq(g.map((x) => [x.date, x.visits.map((y) => y.id)]), [['2026-01-01', ['b']], ['2026-01-02', ['a', 'c']]]);
  });
  await test('validateVisit: 範囲外・日付形式を検出', () => {
    eq(M.validateVisit(v()), []);
    assert(M.validateVisit(v({ lat: 91 })).length === 1);
    assert(M.validateVisit(v({ lng: -181 })).length === 1);
    assert(M.validateVisit(v({ date: '2026/1/1' })).length === 1);
    assert(M.validateVisit(v({ transport: 'rocket' })).length === 1);
    assert(M.validateVisit(v({ transport: 'train' })).length === 0);
  });
  await test('validateTrip: 期間の逆転・不正な地点を検出', () => {
    eq(M.validateTrip(M.createTrip()), []);
    assert(M.validateTrip(M.createTrip({ startDate: '2026-01-05', endDate: '2026-01-01' })).length === 1);
    assert(M.validateTrip(M.createTrip({ visits: [v({ lat: 999 })] })).length === 1);
  });
  await test('formatDateRange', () => {
    assert(M.formatDateRange('2026-01-01', '2026-01-01') === '2026年1月1日');
    assert(M.formatDateRange('2026-01-01', '2026-01-03') === '2026年1月1日 〜 2026年1月3日');
  });

  // ---- routes ------------------------------------------------------------
  await test('routeProfile: 徒歩=foot、車/バス/未指定=driving、電車等は null', () => {
    assert(M.routeProfile('walk') === 'foot' && M.routeProfile('car') === 'driving' && M.routeProfile(null) === 'driving');
    assert(M.routeProfile('train') === null && M.routeProfile('plane') === null);
  });
  await test('segments / missingSegments / pruneRoutes / routeLine', () => {
    let t = M.createTrip({ visits: [v({ id: 'a', lat: 35, lng: 135 }), v({ id: 'b', order: 1, lat: 35.1, lng: 135.1, transport: 'walk' }), v({ id: 'c', order: 2, lat: 35.2, lng: 135.2, transport: 'train' })] });
    const segs = M.segments(t);
    assert(segs.length === 1 && segs[0].profile === 'foot', '電車区間は含まない');
    assert(M.missingSegments(t).length === 1);
    const coords = [[35, 135], [35.05, 135.05], [35.1, 135.1]];
    t = M.setRoute(t, segs[0].key, coords);
    assert(M.missingSegments(t).length === 0);
    eq(M.routeLine(t, t.visits[0], t.visits[1]), coords);
    eq(M.routeLine(t, t.visits[1], t.visits[2]), [[35.1, 135.1], [35.2, 135.2]], '電車は直線');
    eq(M.routeLine({ ...t, routing: 'straight' }, t.visits[0], t.visits[1]).length, 2, '直線モード');
    // 移動手段を変えるとキーが変わり、古い経路は prune で消える
    t = M.updateVisit(t, 'b', { transport: 'car' });
    assert(M.missingSegments(t).length === 1);
    t = M.pruneRoutes(t);
    eq(Object.keys(t.routes), []);
    // 失敗（null）は missing に含めず、failedRouteCount に数える
    t = M.setRoute(t, M.segments(t)[0].key, null);
    assert(M.missingSegments(t).length === 0 && M.failedRouteCount(t) === 1);
  });

  // ---- store -------------------------------------------------------------
  const s = createStore('tabi-ato-test');
  await s.clear();

  await test('store: 保存→読込の往復', async () => {
    const t = M.createTrip({ id: 't1', title: '京都', visits: [v({ id: 'a', name: '清水寺' })] });
    await s.putTrip(t);
    const back = await s.getTrip('t1');
    eq(back, t);
  });
  await test('store: 不正な trip は拒否', async () => {
    await rejects(s.putTrip(M.createTrip({ id: 'bad', visits: [v({ lat: 100 })] })));
    assert((await s.getTrip('bad')) === undefined);
  });
  await test('store: getAllTrips は更新順', async () => {
    await s.putTrip(M.createTrip({ id: 't2', title: '古い', updatedAt: '2020-01-01T00:00:00Z' }));
    await s.putTrip(M.createTrip({ id: 't3', title: '新しい', updatedAt: '2030-01-01T00:00:00Z' }));
    const ids = (await s.getAllTrips()).map((t) => t.id);
    assert(ids[0] === 't3' && ids[ids.length - 1] === 't2', ids.join(','));
  });
  await test('store: deleteTrip は紐づく写真も消す', async () => {
    await s.putPhoto({ id: 'p1', blob: new Blob(['x'], { type: 'image/jpeg' }), thumb: null, width: 1, height: 1, createdAt: 'now' });
    await s.putTrip(M.createTrip({ id: 't4', visits: [v({ id: 'a', photoIds: ['p1'] })] }));
    await s.deleteTrip('t4');
    assert((await s.getTrip('t4')) === undefined);
    assert((await s.getPhoto('p1')) === undefined);
  });
  await test('store: Export→Import で同一（id 含む・写真含む）', async () => {
    await s.clear();
    await s.putPhoto({ id: 'p9', blob: new Blob(['hello'], { type: 'image/jpeg' }), thumb: 'data:,t', width: 3, height: 2, createdAt: 'now' });
    const t = M.createTrip({ id: 't9', title: '往復', visits: [v({ id: 'a', photoIds: ['p9'] })] });
    await s.putTrip(t);
    const data = await s.exportAll();
    assert(data.version === EXPORT_VERSION);
    await s.clear();
    const r = await s.importAll(JSON.parse(JSON.stringify(data)));
    eq(r, { trips: 1, photos: 1 });
    eq(await s.getTrip('t9'), t);
    const p = await s.getPhoto('p9');
    assert(p && (await p.blob.text()) === 'hello' && p.width === 3);
    assert(data.photos.p9.thumb === 'data:,t', 'thumb が書き出されていない');
    assert(p.thumb === 'data:,t', 'thumb が読み込まれていない');
  });
  await test('store: putTrip の楽観ロック（updatedAt 不一致 / 削除済み）', async () => {
    await s.clear();
    const t = M.createTrip({ id: 'lock', updatedAt: '2026-01-01T00:00:00Z' });
    await s.putTrip(t);
    await s.putTrip({ ...t, title: 'ok', updatedAt: '2026-01-02T00:00:00Z' }, { expectUpdatedAt: '2026-01-01T00:00:00Z' });
    let err = null;
    try { await s.putTrip({ ...t, title: 'stale' }, { expectUpdatedAt: '2026-01-01T00:00:00Z' }); } catch (e) { err = e; }
    assert(err && err.code === 'conflict', '競合を検出していない');
    assert((await s.getTrip('lock')).title === 'ok', '競合時に上書きされた');
    err = null;
    try { await s.putTrip(M.createTrip({ id: 'nope' }), { expectUpdatedAt: 'x' }); } catch (e) { err = e; }
    assert(err && err.code === 'deleted', '削除済みを検出していない');
  });
  await test('store: version 不一致は拒否', async () => {
    await rejects(s.importAll({ version: 99, trips: [] }));
    await rejects(s.importAll(null));
  });

  await s.clear();
  await s.close();

  // ---- templates ---------------------------------------------------------
  const tripWithPhotos = M.createTrip({ id: 'tp', title: 'T', visits: [
    v({ id: 'a', order: 0, photoIds: ['p1', 'p2'] }), v({ id: 'b', order: 1, photoIds: ['p3'] }), v({ id: 'c', order: 2 }),
  ] });
  await test('resolveSlots: 通し順で埋まり、余りは null', () => {
    eq(M.resolveSlots(tripWithPhotos, getTemplate('map-hero')), ['p1', 'p2', 'p3']);
    eq(M.resolveSlots(tripWithPhotos, getTemplate('photo-grid')), ['p1', 'p2', 'p3', null, null, null]);
  });
  await test('resolveSlots: perVisit は地点 i の 1 枚目', () => {
    eq(M.resolveSlots(tripWithPhotos, getTemplate('route-timeline')).slice(0, 4), ['p1', 'p3', null, null]);
  });
  await test('resolveSlots: 保存済み割当を優先し、消えた写真は除外', () => {
    const t = { ...tripWithPhotos, slots: { 'map-hero': ['p3', 'gone', null] } };
    eq(M.resolveSlots(t, getTemplate('map-hero')), ['p3', 'p1', 'p2']);
  });
  await test('swapSlots / setSlot', () => {
    const tpl = getTemplate('map-hero');
    eq(M.resolveSlots(M.swapSlots(tripWithPhotos, tpl, 0, 2), tpl), ['p3', 'p2', 'p1']);
    eq(M.resolveSlots(M.setSlot(tripWithPhotos, tpl, 0, 'p3'), tpl), ['p3', 'p2', null], '移動元は自動補充しない');
    eq(M.resolveSlots(M.setSlot(tripWithPhotos, tpl, 1, null), tpl), ['p1', null, 'p3'], '明示的な空は補充しない');
  });
  for (const tpl of TEMPLATE_LIST) {
    await test(`templates: ${tpl.id} は写真ゼロでも落ちず、スロット数どおり`, () => {
      const t = M.createTrip({ id: 'tz', title: 'Z', visits: [v({ id: 'a' }), v({ id: 'b', order: 1 })] });
      const sheet = buildSheet(t, tpl, M.resolveSlots(t, tpl), () => null);
      assert(sheet.classList.contains(`tpl-${tpl.id}`));
      assert(sheet.dataset.orientation === tpl.orientation);
      assert(sheet.querySelector('.sheet__map'), 'map 無し');
      const expected = tpl.perVisit ? Math.min(t.visits.length, tpl.maxVisits) : tpl.photoSlots;
      assert(sheet.querySelectorAll('.slot').length === expected, `slot 数 ${sheet.querySelectorAll('.slot').length}`);
      assert(sheet.querySelectorAll('.slot--empty').length === expected);
    });
  }
  await test('templates: 写真ありで img が入り、超過地点は「他 n 地点」', () => {
    const many = M.createTrip({ id: 'tm', visits: Array.from({ length: 15 }, (_, i) => v({ id: 'v' + i, order: i, name: 'n' + i })) });
    const tpl = getTemplate('map-hero');
    const sheet = buildSheet({ ...many, visits: many.visits.map((x, i) => (i === 0 ? { ...x, photoIds: ['p1'] } : x)) }, tpl, ['p1', null, null], () => 'data:,x');
    assert(sheet.querySelectorAll('.slot__img').length === 1);
    assert(sheet.querySelectorAll('.legend__item').length === tpl.maxVisits);
    assert(sheet.querySelector('.legend__more').textContent === `他 ${15 - tpl.maxVisits} 地点`);
  });

  return results;
}
