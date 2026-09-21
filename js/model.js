/*
 * model.js — Trip / Visit の純粋関数。DOM を触らない。
 * すべて新しいオブジェクトを返す（引数は変更しない）。
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TRANSPORTS = ['walk', 'car', 'train', 'bus', 'plane', 'ship'];
export const MAP_STYLES = ['pale', 'bright', 'osm'];
export const MAP_STYLE_LABELS = { pale: '淡色', bright: '明るい', osm: '標準' };
/** 旧値（CARTO Positron）を新しい既定へ */
const LEGACY_MAP_STYLES = { positron: 'pale' };
export const TEMPLATE_IDS = ['map-hero', 'photo-grid', 'route-timeline',
  'collage', 'magazine', 'album', 'photo-wall', 'hero-photo', 'mosaic', 'stripes', 'two-column', 'polaroid'];
export const ACCENTS = ['ai', 'shu', 'midori', 'karashi', 'budou'];
export const FONTS = ['gothic', 'mincho', 'hand'];

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function createTrip(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || uid(),
    title: partial.title ?? '',
    startDate: partial.startDate ?? today(),
    endDate: partial.endDate ?? partial.startDate ?? today(),
    templateId: partial.templateId ?? 'map-hero',
    theme: { accent: partial.theme?.accent ?? 'ai', font: partial.theme?.font ?? 'gothic' },
    mapStyle: LEGACY_MAP_STYLES[partial.mapStyle] ?? partial.mapStyle ?? 'pale',
    showDates: partial.showDates ?? true,
    subtitle: partial.subtitle ?? '',
    routing: partial.routing === 'straight' ? 'straight' : 'road',  // 線を道なりにするか
    routes: { ...(partial.routes ?? {}) },      // { [segmentKey]: [[lat,lng],...] | null(取得失敗) }
    slots: { ...(partial.slots ?? {}) },        // { [templateId]: (photoId|null)[] } 写真スロット割当
    layout: { ...(partial.layout ?? {}) },      // { [templateId]: { [blockId]: {x,y,w,h} } } 自由配置（mm）
    photoPos: { ...(partial.photoPos ?? {}) },  // { [photoId]: { x, y } } object-position（%）
    visits: normalizeOrder(partial.visits ?? []),
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

export function createVisit(partial = {}) {
  return {
    id: partial.id || uid(),
    order: partial.order ?? 0,
    date: partial.date ?? today(),
    name: partial.name ?? '',
    lat: Number(partial.lat),
    lng: Number(partial.lng),
    comment: partial.comment ?? '',
    photoIds: Array.isArray(partial.photoIds) ? [...partial.photoIds] : [],
    transport: partial.transport ?? null,
    photoPos: partial.photoPos ?? null,
  };
}

/** order 昇順に並べ、0..n-1 に振り直す（元の配列は変更しない） */
export function normalizeOrder(visits) {
  return [...visits]
    .sort((a, b) => a.order - b.order)
    .map((v, i) => ({ ...v, order: i }));
}

export function touch(trip) {
  return { ...trip, updatedAt: new Date().toISOString() };
}

export function addVisit(trip, visit) {
  const v = { ...visit, order: trip.visits.length };
  return touch({ ...trip, visits: normalizeOrder([...trip.visits, v]) });
}

export function updateVisit(trip, visitId, patch) {
  const visits = trip.visits.map((v) => (v.id === visitId ? { ...v, ...patch, id: v.id } : v));
  return touch({ ...trip, visits: normalizeOrder(visits) });
}

export function removeVisit(trip, visitId) {
  return touch({ ...trip, visits: normalizeOrder(trip.visits.filter((v) => v.id !== visitId)) });
}

/** visitId を toIndex の位置へ移動 */
export function moveVisit(trip, visitId, toIndex) {
  const list = normalizeOrder(trip.visits);
  const from = list.findIndex((v) => v.id === visitId);
  if (from < 0) return trip;
  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  if (from === to) return trip;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return touch({ ...trip, visits: list.map((v, i) => ({ ...v, order: i })) });
}

/** 日付昇順（同日は order 順）の安定ソート */
export function sortByDate(visits) {
  return [...visits].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
}

/** [{ date, visits }] を日付昇順で返す */
export function groupByDate(visits) {
  const map = new Map();
  for (const v of sortByDate(visits)) {
    if (!map.has(v.date)) map.set(v.date, []);
    map.get(v.date).push(v);
  }
  return [...map.entries()].map(([date, vs]) => ({ date, visits: vs }));
}

export function validateVisit(v) {
  const errors = [];
  if (!v || typeof v !== 'object') return ['visit が不正です'];
  if (!DATE_RE.test(v.date || '')) errors.push('日付は YYYY-MM-DD 形式にしてください');
  if (!(Number.isFinite(v.lat) && v.lat >= -90 && v.lat <= 90)) errors.push('緯度が範囲外です');
  if (!(Number.isFinite(v.lng) && v.lng >= -180 && v.lng <= 180)) errors.push('経度が範囲外です');
  if (v.transport != null && !TRANSPORTS.includes(v.transport)) errors.push('移動手段が不正です');
  return errors;
}

export function validateTrip(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return ['trip が不正です'];
  if (!t.id) errors.push('id がありません');
  if (!DATE_RE.test(t.startDate || '')) errors.push('開始日は YYYY-MM-DD 形式にしてください');
  if (!DATE_RE.test(t.endDate || '')) errors.push('終了日は YYYY-MM-DD 形式にしてください');
  if (t.startDate && t.endDate && t.startDate > t.endDate) errors.push('終了日が開始日より前です');
  if (!TEMPLATE_IDS.includes(t.templateId)) errors.push('テンプレが不正です');
  if (!MAP_STYLES.includes(t.mapStyle)) errors.push('地図スタイルが不正です');
  if (!ACCENTS.includes(t.theme?.accent)) errors.push('アクセント色が不正です');
  if (!FONTS.includes(t.theme?.font)) errors.push('フォントが不正です');
  if (!Array.isArray(t.visits)) errors.push('visits が配列ではありません');
  else t.visits.forEach((v, i) => validateVisit(v).forEach((e) => errors.push(`地点${i + 1}: ${e}`)));
  return errors;
}

/** 表示用：訪問地の日付範囲で旅の期間を補正した文字列 */
export function formatDateRange(start, end) {
  const f = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return `${y}年${m}月${d}日`;
  };
  if (!start) return '';
  if (!end || end === start) return f(start);
  return `${f(start)} 〜 ${f(end)}`;
}

/** 旅の全写真 id を訪問順に（重複なし） */
export function allPhotoIds(trip) {
  const seen = new Set();
  for (const v of normalizeOrder(trip.visits)) for (const p of v.photoIds) seen.add(p);
  return [...seen];
}

/** photoId → それを持つ Visit */
export function visitOfPhoto(trip, photoId) {
  return trip.visits.find((v) => v.photoIds.includes(photoId)) || null;
}

/**
 * テンプレのスロットに入れる写真 id の配列（長さ = photoSlots、空きは null）。
 * 保存済みの割当（trip.slots[templateId]）を優先し、存在しない写真は除外。
 * 保存値 '' は「明示的に空」で自動補充しない。未割当（null）のスロットは
 * perVisit なら「地点 i の 1 枚目」、それ以外は残りの写真を順に埋める。
 */
export function resolveSlots(trip, tpl) {
  return resolveSlotsDetail(trip, tpl).out;
}

function resolveSlotsDetail(trip, tpl) {
  const valid = new Set(allPhotoIds(trip));
  const saved = trip.slots?.[tpl.id] ?? [];
  const out = [];
  const locked = [];
  for (let i = 0; i < tpl.photoSlots; i++) {
    const id = saved[i];
    locked.push(id === '');
    out.push(id && valid.has(id) ? id : null);
  }
  const used = new Set(out.filter(Boolean));
  const visits = normalizeOrder(trip.visits);
  if (tpl.perVisit) {
    for (let i = 0; i < out.length; i++) {
      if (out[i] || locked[i]) continue;
      const first = visits[i]?.photoIds.find((p) => !used.has(p));
      if (first) { out[i] = first; used.add(first); }
    }
  } else {
    const rest = allPhotoIds(trip).filter((p) => !used.has(p));
    for (let i = 0; i < out.length && rest.length; i++) if (!out[i] && !locked[i]) out[i] = rest.shift();
  }
  return { out, locked };
}

/** 保存用の配列（明示的な空は '' のまま） */
function storedSlots(trip, tpl) {
  const { out, locked } = resolveSlotsDetail(trip, tpl);
  return out.map((p, i) => (locked[i] ? '' : p));
}

/** スロット a と b の写真を入れ替えた trip を返す */
export function swapSlots(trip, tpl, a, b) {
  const cur = storedSlots(trip, tpl);
  [cur[a], cur[b]] = [cur[b], cur[a]];
  return touch({ ...trip, slots: { ...trip.slots, [tpl.id]: cur } });
}

/** スロット index に photoId を入れる（null なら明示的に空にする）。同じ写真が他の枠にあれば外す */
export function setSlot(trip, tpl, index, photoId) {
  // 移動元の枠は '' にして自動補充させない（「動かしたら別の写真が入った」を防ぐ）
  const cur = storedSlots(trip, tpl).map((p) => (photoId && p === photoId ? '' : p));
  cur[index] = photoId ?? '';
  return touch({ ...trip, slots: { ...trip.slots, [tpl.id]: cur } });
}

// ---- 道なりルート（OSRM）----------------------------------------------------

/** 移動手段 → OSRM profile。道路経路が無いものは null（直線） */
export function routeProfile(transport) {
  if (transport === 'walk') return 'foot';
  if (transport == null || transport === 'car' || transport === 'bus') return 'driving';
  return null;
}

const c5 = (n) => Number(n).toFixed(5);

/** 区間キー：両端の座標と profile で決まる（地点の差し替えや移動手段変更で変わる） */
export function segmentKey(from, to, profile) {
  return `${c5(from.lat)},${c5(from.lng)}>${c5(to.lat)},${c5(to.lng)}|${profile}`;
}

/** 道なり対象の区間一覧（order 順の隣接ペア） */
export function segments(trip) {
  const vs = normalizeOrder(trip.visits);
  const out = [];
  for (let i = 1; i < vs.length; i++) {
    const profile = routeProfile(vs[i].transport);
    if (!profile) continue;
    out.push({ key: segmentKey(vs[i - 1], vs[i], profile), from: vs[i - 1], to: vs[i], profile });
  }
  return out;
}

/** まだ取得していない区間（失敗して null のものは含めない） */
export function missingSegments(trip) {
  return segments(trip).filter((s) => !(s.key in (trip.routes || {})));
}

/** 現在の区間に無い経路を捨てる */
export function pruneRoutes(trip) {
  const keep = new Set(segments(trip).map((s) => s.key));
  const routes = {};
  for (const [k, v] of Object.entries(trip.routes || {})) if (keep.has(k)) routes[k] = v;
  return { ...trip, routes };
}

export function setRoute(trip, key, coords) {
  return { ...trip, routes: { ...trip.routes, [key]: coords } };
}

/** 描画用：区間 (from→to) の座標列。道なりが無ければ直線 */
export function routeLine(trip, from, to) {
  const straight = [[from.lat, from.lng], [to.lat, to.lng]];
  if (trip.routing !== 'road') return straight;
  const profile = routeProfile(to.transport);
  if (!profile) return straight;
  const r = trip.routes?.[segmentKey(from, to, profile)];
  return Array.isArray(r) && r.length >= 2 ? r : straight;
}

/** 道なりにできなかった区間数（取得失敗＝null） */
export function failedRouteCount(trip) {
  return segments(trip).filter((s) => trip.routes?.[s.key] === null).length;
}

// ---- 自由配置（A4 上のブロック、単位 mm）------------------------------------

export const SHEET_MM = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };
export const BLOCK_MIN = 10;

/** 用紙内に収まるよう丸めて補正した {x,y,w,h} */
export function clampBlock(g, orientation) {
  const S = SHEET_MM[orientation] || SHEET_MM.portrait;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  let w = Math.max(BLOCK_MIN, Math.min(S.w, num(g.w, BLOCK_MIN)));
  let h = Math.max(BLOCK_MIN, Math.min(S.h, num(g.h, BLOCK_MIN)));
  let x = Math.max(0, Math.min(S.w - w, num(g.x, 0)));
  let y = Math.max(0, Math.min(S.h - h, num(g.y, 0)));
  return { x, y, w, h };
}

/** テンプレの初期配置に保存済みの配置を重ねた { [blockId]: {x,y,w,h} } */
export function resolveLayout(trip, tpl) {
  const saved = trip.layout?.[tpl.id] || {};
  const out = {};
  for (const b of tpl.blocks) {
    const g = saved[b.id] && typeof saved[b.id] === 'object' ? saved[b.id] : b;
    out[b.id] = clampBlock(g, tpl.orientation);
  }
  return out;
}

export function setBlock(trip, tpl, blockId, geom) {
  if (!tpl.blocks.some((b) => b.id === blockId)) return trip;
  const cur = { ...(trip.layout?.[tpl.id] || {}), [blockId]: clampBlock(geom, tpl.orientation) };
  return touch({ ...trip, layout: { ...trip.layout, [tpl.id]: cur } });
}

export function resetLayout(trip, tpl) {
  const layout = { ...trip.layout };
  delete layout[tpl.id];
  return touch({ ...trip, layout });
}
