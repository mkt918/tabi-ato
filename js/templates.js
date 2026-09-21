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

import { formatDateRange, visitOfPhoto, groupByDate } from './model.js';

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

export const TEMPLATES = {
  'map-hero': {
    id: 'map-hero',
    name: '地図メイン',
    orientation: 'portrait',
    photoSlots: 3,
    perVisit: false,       // スロットは写真の通し順で埋める
    maxVisits: 12,
    textSlots: ['title', 'dates', 'subtitle'],
    build(ctx) {
      return [
        buildHead(ctx),
        el('div', { class: 'sheet__map' }),
        buildLegend(ctx),
        el('div', { class: 'sheet__photos' }, ...ctx.slots.map((_, i) => ctx.slotFigure(i, { caption: 'name+comment' }))),
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
    build(ctx) {
      return [
        buildHead(ctx),
        el('div', { class: 'sheet__map' }),
        buildLegend(ctx),
        el('div', { class: 'sheet__photos' }, ...ctx.slots.map((_, i) => ctx.slotFigure(i, { caption: 'name' }))),
      ];
    },
  },

  'route-timeline': {
    id: 'route-timeline',
    name: '横長ルート',
    orientation: 'landscape',
    photoSlots: 8,
    perVisit: true,        // スロット i = 地点 i の写真
    maxVisits: 8,
    textSlots: ['title', 'dates', 'subtitle'],
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
      return [buildHead(ctx), el('div', { class: 'sheet__map' }), timeline];
    },
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES['map-hero'];
}

/**
 * A4 の DOM（.sheet）を組み立てて返す。Leaflet は .sheet__map に呼び出し側が載せる。
 * @param {object} trip
 * @param {(photoId|null)[]} slots  model.resolveSlots(trip, tpl) の結果
 * @param {(id: string) => string|null} photoUrl
 */
export function buildSheet(trip, tpl, slots, photoUrl) {
  const visits = [...trip.visits].sort((a, b) => a.order - b.order);
  const shown = visits.slice(0, tpl.maxVisits);
  const ctx = {
    trip, visits, shown, overflow: visits.length - shown.length, slots, photoUrl, el,
    slotFigure(i, { caption = 'name' } = {}) {
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
      if (owner && caption !== 'none') {
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
  return sheet;
}
