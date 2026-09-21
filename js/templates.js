/*
 * templates.js — A4 テンプレのスロット定義と DOM 組み立て。
 * ここは「DOM を作るだけ」。Leaflet の生成・写真 URL の解決・保存は print-view.js が行う。
 *
 * 各テンプレは buildSheet() から呼ばれる build(ctx) を持つ。ctx:
 *   trip        … Trip
 *   visits      … order 昇順の Visit[]（全地点）
 *   shown       … 一覧・写真に出す地点（先頭から maxVisits まで）
 *   overflow    … shown から漏れた地点数
 *   slots       … (photoId|null)[]（長さ photoSlots。model.resolveSlots の結果）
 *   photoUrl(id)… 表示用 URL（無ければ null）
 *   slotFigure(i, opts) … スロット i の <figure class="slot"> を作る共通関数
 *   el(tag, attrs, ...children) … 要素生成
 *
 * 見た目は css/print.css の .tpl-<id> で切り替える。新しいテンプレを足すときは
 * map-hero を手本に「定義 → build → print.css」の 3 点をそろえる。
 */

import { formatDateRange, visitOfPhoto, groupByDate, resolveLayout } from './model.js';

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style') e.setAttribute('style', v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

/** タイトル・期間・サブタイトルのヘッダ（全テンプレ共通） */
function buildHead(ctx) {
  const { trip } = ctx;
  return el('header', { class: 'sheet__head' },
    el('h1', { class: 'sheet__title' }, trip.title || '旅の記録'),
    trip.showDates ? el('p', { class: 'sheet__dates' }, formatDateRange(trip.startDate, trip.endDate)) : null,
    trip.subtitle ? el('p', { class: 'sheet__subtitle' }, trip.subtitle) : null,
  );
}

/** 番号つき地点一覧。超過分は「他 n 地点」 */
function buildLegend(ctx, { withComment = false } = {}) {
  const list = el('ol', { class: 'sheet__legend' });
  for (const v of ctx.shown) {
    list.append(el('li', { class: 'legend__item' },
      el('span', { class: 'legend__no' }, String(v.order + 1)),
      el('span', { class: 'legend__name' }, v.name || '（名前なし）'),
      withComment && v.comment ? el('span', { class: 'legend__comment' }, v.comment) : null,
    ));
  }
  if (ctx.overflow > 0) list.append(el('li', { class: 'legend__more' }, `他 ${ctx.overflow} 地点`));
  return list;
}

// ---- テンプレ定義 ---------------------------------------------------------
// blocks: ブロックの初期配置（mm、用紙左上原点）。id は build() が返す要素の data-block と一致させる。
// kind: 'head' | 'map' | 'legend' | 'slot' | 'timeline'。slot は { slot: i } を持つ。
// 保存済みの配置（Trip.layout）はこの初期値に上書きされる（model.resolveLayout）。

const M = 12; // 余白 mm

/** 3 列 × rows 行の写真枠を作る */
function slotGrid({ y, h, rows, cols = 3, x = M, width = 210 - M * 2, gap = 4 }) {
  const w = Math.floor((width - gap * (cols - 1)) / cols);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    out.push({ id: `slot-${i}`, kind: 'slot', slot: i, x: x + c * (w + gap), y: y + r * (h + gap), w, h });
  }
  return out;
}

function slotFigures(ctx, caption, extraClass = '') {
  return ctx.slots.map((_, i) => {
    const fig = ctx.slotFigure(i, { caption });
    fig.dataset.block = `slot-${i}`;
    if (extraClass) fig.classList.add(extraClass);
    return fig;
  });
}

/** 任意の矩形リストから slot ブロックを作る */
function slotsAt(rects) {
  return rects.map(([x, y, w, h], i) => ({ id: `slot-${i}`, kind: 'slot', slot: i, x, y, w, h }));
}

const HEAD = { id: 'head', kind: 'head', x: M, y: M, w: 186, h: 18 };
const mapAt = (x, y, w, h) => ({ id: 'map', kind: 'map', x, y, w, h });
const legendAt = (x, y, w, h) => ({ id: 'legend', kind: 'legend', x, y, w, h });

/** 縦・写真多めテンプレの共通 build（head / map / legend / slots） */
function buildPhotoPage(ctx, caption = 'auto', extraClass = '') {
  return [
    withBlock(buildHead(ctx), 'head'),
    withBlock(el('div', { class: 'sheet__map' }), 'map'),
    withBlock(buildLegend(ctx), 'legend'),
    ...slotFigures(ctx, caption, extraClass),
  ];
}

/** 縦・写真多めテンプレの定義を短く書く */
function photoTemplate(id, name, blocks, { caption = 'auto', extraClass = '', maxVisits = 10 } = {}) {
  const photoSlots = blocks.filter((b) => b.kind === 'slot').length;
  return { id, name, orientation: 'portrait', photoSlots, perVisit: false, maxVisits, textSlots: ['title', 'dates', 'subtitle'], blocks,
    build(ctx) { return buildPhotoPage(ctx, caption, extraClass); } };
}

export const TEMPLATES = {
  'map-hero': {
    id: 'map-hero',
    name: '地図メイン',
    orientation: 'portrait',
    photoSlots: 3,
    perVisit: false,       // スロットは写真の通し順で埋める
    maxVisits: 12,
    textSlots: ['title', 'dates', 'subtitle'],
    blocks: [
      { id: 'head', kind: 'head', x: M, y: M, w: 186, h: 18 },
      { id: 'map', kind: 'map', x: M, y: 34, w: 186, h: 152 },
      { id: 'legend', kind: 'legend', x: M, y: 190, w: 186, h: 22 },
      ...slotGrid({ y: 216, h: 69, rows: 1 }),
    ],
    build(ctx) {
      return [
        withBlock(buildHead(ctx), 'head'),
        withBlock(el('div', { class: 'sheet__map' }), 'map'),
        withBlock(buildLegend(ctx), 'legend'),
        ...slotFigures(ctx, 'name+comment'),
      ];
    },
  },

  'photo-grid': {
    id: 'photo-grid',
    name: 'フォト多め',
    orientation: 'portrait',
    photoSlots: 6,
    perVisit: false,
    maxVisits: 10,
    textSlots: ['title', 'dates', 'subtitle'],
    blocks: [
      { id: 'head', kind: 'head', x: M, y: M, w: 186, h: 18 },
      { id: 'map', kind: 'map', x: M, y: 34, w: 186, h: 78 },
      { id: 'legend', kind: 'legend', x: M, y: 116, w: 186, h: 22 },
      ...slotGrid({ y: 142, h: 68, rows: 2 }),
    ],
    build(ctx) {
      return [
        withBlock(buildHead(ctx), 'head'),
        withBlock(el('div', { class: 'sheet__map' }), 'map'),
        withBlock(buildLegend(ctx), 'legend'),
        ...slotFigures(ctx, 'name'),
      ];
    },
  },

  'route-timeline': {
    id: 'route-timeline',
    name: '横長ルート',
    orientation: 'landscape',
    photoSlots: 8,
    perVisit: true,        // スロット i = 地点 i の写真（タイムラインの中に並ぶ）
    maxVisits: 8,
    textSlots: ['title', 'dates', 'subtitle'],
    blocks: [
      { id: 'head', kind: 'head', x: M, y: M, w: 136, h: 18 },
      { id: 'map', kind: 'map', x: M, y: 34, w: 136, h: 164 },
      { id: 'timeline', kind: 'timeline', x: 152, y: M, w: 133, h: 186 },
    ],
    build(ctx) {
      const timeline = el('div', { class: 'sheet__timeline' });
      for (const g of groupByDate(ctx.shown)) {
        const items = el('div', { class: 'tl__items' });
        for (const v of g.visits) {
          const photo = ctx.slotFigure(v.order, { caption: 'none' });
          photo.classList.add('tl__photo');
          items.append(el('div', { class: 'tl__item' },
            el('span', { class: 'legend__no' }, String(v.order + 1)),
            el('div', { class: 'tl__body' },
              el('div', { class: 'tl__name' }, v.name || '（名前なし）'),
              v.comment ? el('div', { class: 'tl__comment' }, v.comment) : null,
            ),
            photo,
          ));
        }
        timeline.append(el('div', { class: 'tl__date' }, formatDateRange(g.date, g.date)), items);
      }
      if (ctx.overflow > 0) timeline.append(el('p', { class: 'legend__more' }, `他 ${ctx.overflow} 地点`));
      return [withBlock(buildHead(ctx), 'head'), withBlock(el('div', { class: 'sheet__map' }), 'map'), withBlock(timeline, 'timeline')];
    },
  },

  // ---- Phase 5：縦・写真多め（配置は blocks が主体。キャプションは枠の幅で自動） ----
  'collage': photoTemplate('collage', 'コラージュ', [
    HEAD,
    ...slotsAt([[M, 34, 120, 90], [136, 34, 62, 43], [136, 81, 62, 43], [M, 128, 91, 108], [107, 128, 91, 108]]),
    legendAt(M, 240, 122, 45), mapAt(138, 240, 60, 45),
  ]),
  'magazine': photoTemplate('magazine', '雑誌風', [
    HEAD,
    ...slotsAt([[M, 34, 186, 70], [M, 108, 91, 60], [107, 108, 91, 60], [M, 172, 59, 55], [75, 172, 60, 55], [139, 172, 59, 55]]),
    legendAt(M, 231, 122, 54), mapAt(138, 231, 60, 54),
  ]),
  'album': photoTemplate('album', 'アルバム', [
    HEAD, mapAt(M, 34, 186, 40), legendAt(M, 78, 186, 14),
    ...slotsAt([0, 1, 2, 3].flatMap((r) => {
      const y = 96 + r * 48;
      return r % 2 === 0 ? [[M, y, 110, 45], [126, y, 72, 45]] : [[M, y, 72, 45], [88, y, 110, 45]];
    })),
  ]),
  'photo-wall': photoTemplate('photo-wall', 'フォトウォール', [
    HEAD, mapAt(M, 34, 186, 40), legendAt(M, 78, 186, 12),
    ...slotsAt([0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => [M + c * 63.5, 94 + r * 64, 59, 59]))).map((b) => ({ ...b, x: Math.round(b.x) })),
  ]),
  'hero-photo': photoTemplate('hero-photo', '写真メイン', [
    HEAD,
    ...slotsAt([[M, 34, 186, 150], [M, 188, 60, 55], [76, 188, 60, 55]]),
    mapAt(140, 188, 58, 55), legendAt(M, 247, 186, 38),
  ]),
  'mosaic': photoTemplate('mosaic', 'モザイク', [
    HEAD,
    ...slotsAt([[M, 34, 120, 120], [136, 34, 62, 58], [136, 96, 62, 58], [M, 158, 43, 44], [59, 158, 43, 44], [106, 158, 43, 44], [153, 158, 45, 44]]),
    legendAt(M, 206, 186, 14), mapAt(M, 224, 186, 61),
  ]),
  'stripes': photoTemplate('stripes', '横帯', [
    { ...HEAD, w: 120, h: 40 }, mapAt(136, M, 62, 40),
    ...slotsAt([0, 1, 2, 3].map((r) => [M, 56 + r * 52, 186, 48])),
    legendAt(M, 264, 186, 21),
  ], { caption: 'name' }),
  'two-column': photoTemplate('two-column', '2 列', [
    HEAD, mapAt(M, 34, 90, 200),
    ...slotsAt([0, 1, 2, 3, 4].map((r) => [106, 34 + r * 41, 92, 37])),
    legendAt(M, 240, 186, 45),
  ], { caption: 'name' }),
  'polaroid': photoTemplate('polaroid', 'ポラロイド', [
    HEAD,
    ...slotsAt([0, 1, 2].flatMap((r) => [[20, 34 + r * 74, 86, 70], [104, 34 + r * 74, 86, 70]])),
    legendAt(M, 256, 122, 29), mapAt(138, 254, 60, 31),
  ], { caption: 'name', extraClass: 'slot--polaroid' }),
};

function withBlock(node, id) { node.dataset.block = id; return node; }

export const TEMPLATE_LIST = Object.values(TEMPLATES);

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['map-hero'];
}

/**
 * A4 の DOM（.sheet）を組み立てて返す。Leaflet は .sheet__map に呼び出し側が載せる。
 * @param {object} trip
 * @param {(photoId|null)[]} slots  model.resolveSlots(trip, tpl) の結果
 * 各ブロックは data-block を持ち、配置は Trip.layout（無ければ tpl.blocks）で絶対配置される
 * @param {(id: string) => string|null} photoUrl
 */
export function buildSheet(trip, tpl, slots, photoUrl) {
  const visits = [...trip.visits].sort((a, b) => a.order - b.order);
  const shown = visits.slice(0, tpl.maxVisits);
  const layout = resolveLayout(trip, tpl);
  const ctx = {
    trip, visits, shown, overflow: visits.length - shown.length, slots, photoUrl, el,
    slotFigure(i, { caption = 'name' } = {}) {
      if (caption === 'auto') caption = captionForWidth(layout[`slot-${i}`]?.w);
      const pid = slots[i] || null;
      const url = pid ? photoUrl(pid) : null;
      const owner = pid ? visitOfPhoto(trip, pid) : null;
      const pos = pid ? trip.photoPos?.[pid] : null;
      const fig = el('figure', { class: 'slot' + (url ? '' : ' slot--empty'), dataset: { slot: String(i), photo: pid || '' } });
      if (url) {
        fig.append(el('img', { class: 'slot__img', src: url, alt: '',
          style: pos ? `object-position:${pos.x}% ${pos.y}%` : null }));
      } else {
        fig.append(el('span', { class: 'slot__empty' }, '写真'));
      }
      if (owner && caption === 'no') {
        fig.append(el('span', { class: 'slot__badge' }, String(owner.order + 1)));
      } else if (owner && caption !== 'none') {
        const parts = [el('span', { class: 'slot__no' }, String(owner.order + 1)), el('span', { class: 'slot__name' }, owner.name)];
        if (caption === 'name+comment' && owner.comment) parts.push(el('span', { class: 'slot__comment' }, owner.comment));
        fig.append(el('figcaption', { class: 'slot__cap' }, ...parts));
      }
      return fig;
    },
  };
  const sheet = el('div', {
    class: `sheet tpl-${tpl.id} accent-${trip.theme.accent} font-${trip.theme.font}`,
    dataset: { orientation: tpl.orientation },
  }, ...tpl.build(ctx));
  applyLayout(sheet, layout);
  return sheet;
}

/** 枠の幅からキャプションの種類を決める：90mm 以上＝地名＋ひとこと、60mm 以上＝地名、それ未満＝番号のみ */
export function captionForWidth(w) {
  if (!Number.isFinite(w)) return 'name';
  if (w >= 90) return 'name+comment';
  if (w >= 60) return 'name';
  return 'no';
}

/** 各ブロックに配置（mm）を当てる */
export function applyLayout(sheet, layout) {
  for (const node of sheet.querySelectorAll('[data-block]')) {
    const g = layout[node.dataset.block];
    if (!g) continue;
    node.style.left = `${g.x}mm`;
    node.style.top = `${g.y}mm`;
    node.style.width = `${g.w}mm`;
    node.style.height = `${g.h}mm`;
  }
}

/**
 * 用紙に載せた後に、地点一覧（legend）とタイムラインの溢れを直す（DOM の実測が要るので mount 後に呼ぶ）。
 * 手順：文字を段階的に縮める（最大 3 段）→ それでも溢れる項目を末尾から外し「他 n 地点」に足す。
 * @returns {number} 外した地点数
 */
export function fitOverflow(sheet) {
  let dropped = 0;
  for (const block of sheet.querySelectorAll('.sheet__legend, .sheet__timeline')) {
    const overflow = () => block.scrollHeight > block.clientHeight + 0.5;
    if (!overflow()) continue;
    for (const size of ['0.95em', '0.9em', '0.85em']) {
      block.style.fontSize = size;
      if (!overflow()) break;
    }
    if (!overflow()) continue;
    const itemSel = block.classList.contains('sheet__legend') ? '.legend__item' : '.tl__item';
    let more = block.querySelector('.legend__more');
    let hidden = more ? Number((more.textContent.match(/\d+/) || [0])[0]) : 0;
    let guard = 200;
    while (overflow() && guard-- > 0) {
      const items = block.querySelectorAll(itemSel);
      if (items.length <= 1) break;
      const last = items[items.length - 1];
      const group = last.parentElement;
      last.remove();
      hidden++; dropped++;
      // タイムライン：項目が無くなった日付見出しも外す
      if (group.classList.contains('tl__items') && group.children.length === 0) {
        const date = group.previousElementSibling;
        group.remove();
        if (date && date.classList.contains('tl__date')) date.remove();
      }
      if (!more) {
        more = document.createElement(block.classList.contains('sheet__legend') ? 'li' : 'p');
        more.className = 'legend__more';
      }
      more.textContent = `他 ${hidden} 地点`;
      block.append(more);
    }
  }
  return dropped;
}
