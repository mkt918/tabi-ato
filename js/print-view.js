/*
 * print-view.js — 印刷ビュー #/print/<id>。
 * 左：調整パネル／右：A4 プレビュー（.sheet-viewport 内で縮小表示）。
 * 変更のたびに .sheet を作り直し、Leaflet も別インスタンスとして作り直す。
 */

import { store } from './store.js';
import * as M from './model.js';
import { createMap } from './map.js';
import { TEMPLATE_LIST, getTemplate, buildSheet, applyLayout } from './templates.js';
import { root, h, toast, makeSaver } from './ui.js';

const ACCENT_LABELS = { ai: '藍', shu: '朱', midori: '深緑', karashi: '芥子', budou: '葡萄' };
const FONT_LABELS = { gothic: 'ゴシック', mincho: '明朝', hand: '手書き風' };
const MM = 96 / 25.4; // 1mm の px

export async function renderPrint({ id }) {
  let trip = await store.getTrip(id);
  if (!trip) {
    root.replaceChildren(h('main', { class: 'page' },
      h('p', { class: 'empty' }, 'この旅は見つかりません。'), h('a', { class: 'btn', href: '#/' }, '一覧へ')));
    return () => {};
  }

  // -- 写真 URL（Blob → objectURL。離脱時に revoke）
  const urls = new Map();
  const thumbs = new Map();
  for (const pid of M.allPhotoIds(trip)) {
    const p = await store.getPhoto(pid);
    if (p) { urls.set(pid, URL.createObjectURL(p.blob)); thumbs.set(pid, p.thumb); }
  }
  const photoUrl = (pid) => urls.get(pid) || null;

  const statusEl = h('span', { class: 'save-status' }, '保存済み');
  let alive = true;
  const save = makeSaver(statusEl, {
    baseUpdatedAt: trip.updatedAt,
    onConflict: (kind) => { alive = false; if (kind === 'deleted') location.hash = '#/'; else location.reload(); },
  });
  const commit = (next, { rebuild = true } = {}) => { if (!alive) return; trip = next; save(trip); if (rebuild) build(); };

  // -- 印刷ボタン（タイル load ＋ フォント ready で有効化）
  const printBtn = h('button', { class: 'btn btn--primary', type: 'button', disabled: true, onclick: () => window.print() }, '印刷 / PDF 保存');
  const printNote = h('p', { class: 'hint print-note' }, '印刷ダイアログで「背景のグラフィック」をオンにしてください。用紙は A4・余白なし。PNG は Canva などに読み込んで飾り付けに使えます。');

  // PNG 書き出し（html2canvas）。縮小表示を一時的に原寸へ戻して描画する
  const pngBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: async (e) => {
    if (typeof html2canvas === 'undefined') { toast('画像化ライブラリを読み込めませんでした。ネットワークを確認して再読み込みしてください', 'error'); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '作成中…';
    const prevScale = viewport.style.getPropertyValue('--sheet-scale');
    viewport.style.setProperty('--sheet-scale', '1');
    try {
      const canvas = await html2canvas(sheet, { useCORS: true, scale: 2, backgroundColor: null, logging: false,
        // html2canvas は oklch を解釈できない。複製側の body だけ hex にする（.sheet 内は print.css で hex 固定）
        onclone: (doc) => { doc.body.style.background = '#fff'; doc.body.style.color = '#000'; } });
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${trip.title || 'tabi-ato'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
      toast(`PNG を作成できませんでした：${err.message}。地図タイルが読み込まれてからもう一度お試しください`, 'error');
    } finally {
      viewport.style.setProperty('--sheet-scale', prevScale);
      btn.disabled = false; btn.textContent = 'PNG で保存';
    }
  } }, 'PNG で保存');

  // -- 調整パネル
  let selectedSlot = null;
  let layoutMode = false; // レイアウト調整：ブロックの移動・リサイズ（写真の選択・位置調整は無効）
  const panel = h('aside', { class: 'print-panel' });

  function renderPanel() {
    const tpl = getTemplate(trip.templateId);
    const slots = M.resolveSlots(trip, tpl);
    const inSlot = new Set(slots.filter(Boolean));
    const customized = !!trip.layout?.[tpl.id];

    panel.replaceChildren(
      h('div', { class: 'field layout-field' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: layoutMode,
          onchange: (e) => { layoutMode = e.target.checked; selectedSlot = null; build(); } }), ' レイアウト調整'),
        h('p', { class: 'hint' }, layoutMode
          ? 'ブロックをドラッグで移動、右下の四角で大きさを変えます（1mm 単位、用紙の中だけ）。'
          : 'オンにすると、タイトル・地図・地点一覧・写真枠の位置と大きさを変えられます。'),
        customized ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => {
          if (confirm('このテンプレートの配置を初期状態に戻します。よろしいですか？')) commit(M.resetLayout(trip, tpl));
        } }, 'テンプレの初期配置に戻す') : null,
      ),
      field('テンプレート', h('div', { class: 'choice-row' },
        ...TEMPLATE_LIST.map((t) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(t.id === trip.templateId),
          onclick: () => { selectedSlot = null; commit(M.touch({ ...trip, templateId: t.id })); } }, t.name)))),
      field('アクセント', h('div', { class: 'choice-row' },
        ...M.ACCENTS.map((a) => h('button', { class: `swatch swatch--${a}`, type: 'button', title: ACCENT_LABELS[a], 'aria-label': ACCENT_LABELS[a],
          'aria-pressed': String(a === trip.theme.accent),
          onclick: () => commit(M.touch({ ...trip, theme: { ...trip.theme, accent: a } })) })))),
      field('フォント', h('div', { class: 'choice-row' },
        ...M.FONTS.map((f) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f === trip.theme.font),
          onclick: () => commit(M.touch({ ...trip, theme: { ...trip.theme, font: f } })) }, FONT_LABELS[f])))),
      field('タイトル', h('input', { type: 'text', class: 'input', value: trip.title, placeholder: '旅の記録',
        oninput: (e) => { commit(M.touch({ ...trip, title: e.target.value }), { rebuild: false }); patchText(); } })),
      field('サブタイトル', h('input', { type: 'text', class: 'input', value: trip.subtitle, placeholder: '例：家族で、春の京都',
        oninput: (e) => { commit(M.touch({ ...trip, subtitle: e.target.value }), { rebuild: false }); patchText(); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: trip.showDates,
        onchange: (e) => commit(M.touch({ ...trip, showDates: e.target.checked })) }), ' 期間を表示'),
      field('地図', h('div', { class: 'choice-row' },
        ...[['positron', '淡色'], ['osm', '標準']].map(([val, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(val === trip.mapStyle),
          onclick: () => commit(M.touch({ ...trip, mapStyle: val })) }, label)))),
      field(`写真（${tpl.photoSlots} 枠）`, h('div', {},
        h('p', { class: 'hint' }, selectedSlot == null
          ? 'プレビューの写真枠をクリックして選び、ここから写真を入れます。枠を 2 つ続けてクリックすると入れ替え。写真の上でドラッグすると見せる位置を調整。'
          : `枠 ${selectedSlot + 1} を選択中。写真をクリックで入れます。`),
        h('div', { class: 'photo-bank' },
          ...M.allPhotoIds(trip).map((pid) => {
            const owner = M.visitOfPhoto(trip, pid);
            return h('button', { class: 'bank-item' + (inSlot.has(pid) ? ' bank-item--used' : ''), type: 'button', title: owner?.name || '',
              disabled: selectedSlot == null,
              onclick: () => { commit(M.setSlot(trip, tpl, selectedSlot, pid)); } },
              h('img', { src: thumbs.get(pid), alt: '' }),
              owner ? h('span', { class: 'bank-item__no' }, String(owner.order + 1)) : null);
          }),
          M.allPhotoIds(trip).length === 0 ? h('p', { class: 'hint' }, '写真はまだありません。編集画面で訪問地に追加できます。') : null,
        ),
        selectedSlot != null && slots[selectedSlot] ? h('button', { class: 'btn btn--sm', type: 'button',
          onclick: () => commit(M.setSlot(trip, tpl, selectedSlot, null)) }, `枠 ${selectedSlot + 1} を空にする`) : null,
      )),
    );
  }

  /** タイトル・サブタイトルだけを差し替える（地図を作り直さない） */
  function patchText() {
    if (!sheet) return;
    const t = sheet.querySelector('.sheet__title');
    if (t) t.textContent = trip.title || '旅の記録';
    const head = sheet.querySelector('.sheet__head');
    let sub = sheet.querySelector('.sheet__subtitle');
    if (trip.subtitle) {
      if (!sub) { sub = document.createElement('p'); sub.className = 'sheet__subtitle'; head?.append(sub); }
      sub.textContent = trip.subtitle;
    } else if (sub) sub.remove();
  }

  function field(label, control) {
    return h('div', { class: 'field' }, h('span', { class: 'field__label' }, label), control);
  }

  // -- プレビュー
  const viewport = h('div', { class: 'sheet-viewport' });
  const pageStyle = h('style');
  let map = null;
  let sheet = null;
  let buildSeq = 0; // 古い build の完了通知を無視するため

  function build() {
    if (map) { map.destroy(); map = null; }
    const tpl = getTemplate(trip.templateId);
    const slots = M.resolveSlots(trip, tpl);
    sheet = buildSheet(trip, tpl, slots, photoUrl);
    pageStyle.textContent = `@page { size: A4 ${tpl.orientation}; margin: 0; }`;
    viewport.replaceChildren(sheet);
    fitScale();

    // 地図（別インスタンス・操作無効）
    const mapEl = sheet.querySelector('.sheet__map');
    printBtn.disabled = true;
    pngBtn.disabled = true;
    const seq = ++buildSeq;
    if (mapEl) {
      map = createMap(mapEl, { style: trip.mapStyle, interactive: false, color: getComputedStyle(sheet).getPropertyValue('--sheet-accent').trim() || undefined });
      map.setVisits(trip.visits, { routeOf: (a, b) => M.routeLine(trip, a, b) });
      const ready = Promise.all([map.whenTilesLoaded(), document.fonts.ready]);
      const timeout = new Promise((r) => setTimeout(() => r('timeout'), 10000));
      Promise.race([ready, timeout]).then((v) => {
        if (seq !== buildSeq) return;
        printBtn.disabled = false;
        pngBtn.disabled = false;
        if (v !== 'timeout' && map && map.tileErrorCount() > 0) toast('地図の一部が読み込めませんでした。白い部分があれば、少し待ってからテンプレートを選び直してください', 'error');
        if (v === 'timeout') toast('地図タイルの読み込みに時間がかかっています。地図が白いまま印刷されたら、少し待ってからもう一度お試しください', 'error');
      });
    } else {
      document.fonts.ready.then(() => { if (seq === buildSeq) { printBtn.disabled = false; pngBtn.disabled = false; } });
    }

    if (layoutMode) {
      sheet.classList.add('sheet--layout');
      sheet.querySelectorAll(':scope > [data-block]').forEach((node) => attachBlockDrag(node, tpl));
      renderPanel();
      return;
    }

    // スロット選択・入替
    sheet.querySelectorAll('.slot').forEach((fig) => {
      const i = Number(fig.dataset.slot);
      if (i === selectedSlot) fig.classList.add('slot--selected');
      fig.addEventListener('click', () => {
        if (dragMoved) return;
        if (selectedSlot == null || selectedSlot === i) { selectedSlot = selectedSlot === i ? null : i; }
        else { const a = selectedSlot; selectedSlot = null; commit(M.swapSlots(trip, tpl, a, i)); return; }
        sheet.querySelectorAll('.slot--selected').forEach((x) => x.classList.remove('slot--selected'));
        if (selectedSlot != null) fig.classList.add('slot--selected');
        renderPanel();
      });
      const img = fig.querySelector('.slot__img');
      if (img) attachPosDrag(img, fig.dataset.photo);
    });
    renderPanel();
  }

  // 写真の見せ位置：画像上をドラッグして object-position を調整
  let dragMoved = false;
  function attachPosDrag(img, pid) {
    let start = null;
    img.addEventListener('pointerdown', (e) => {
      const pos = trip.photoPos[pid] || { x: 50, y: 50 };
      start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      dragMoved = false;
      img.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    img.addEventListener('pointermove', (e) => {
      if (!start) return;
      const scale = Number(viewport.style.getPropertyValue('--sheet-scale')) || 1;
      const r = img.getBoundingClientRect();
      const dx = (e.clientX - start.x) / Math.max(1, r.width) * 100;
      const dy = (e.clientY - start.y) / Math.max(1, r.height) * 100;
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 3) dragMoved = true;
      const x = Math.max(0, Math.min(100, start.px - dx * 1.5));
      const y = Math.max(0, Math.min(100, start.py - dy * 1.5));
      img.style.objectPosition = `${x}% ${y}%`;
      start.cur = { x, y };
      void scale;
    });
    const end = () => {
      if (!start) return;
      if (start.cur) commit(M.touch({ ...trip, photoPos: { ...trip.photoPos, [pid]: { x: Math.round(start.cur.x), y: Math.round(start.cur.y) } } }), { rebuild: false });
      start = null;
      setTimeout(() => { dragMoved = false; }, 0);
    };
    img.addEventListener('pointerup', end);
    img.addEventListener('pointercancel', end);
  }

  // レイアウト調整：ブロックのドラッグ移動・右下ハンドルでリサイズ
  function attachBlockDrag(node, tpl) {
    const HANDLE = 6; // mm
    let st = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const g = M.resolveLayout(trip, tpl)[node.dataset.block];
      const scale = Number(viewport.style.getPropertyValue('--sheet-scale')) || 1;
      const r = node.getBoundingClientRect();
      const mmX = (e.clientX - r.left) / (MM * scale);
      const mmY = (e.clientY - r.top) / (MM * scale);
      const resize = mmX > g.w - HANDLE && mmY > g.h - HANDLE;
      st = { x: e.clientX, y: e.clientY, g, scale, resize, cur: g };
      sheet.querySelectorAll('.block--active').forEach((x) => x.classList.remove('block--active'));
      node.classList.add('block--active');
      node.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
    node.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = (e.clientX - st.x) / (MM * st.scale);
      const dy = (e.clientY - st.y) / (MM * st.scale);
      const next = st.resize
        ? { ...st.g, w: st.g.w + dx, h: st.g.h + dy }
        : { ...st.g, x: st.g.x + dx, y: st.g.y + dy };
      st.cur = M.clampBlock(next, tpl.orientation);
      applyLayout(sheet, { [node.dataset.block]: st.cur });
    });
    const end = () => {
      if (!st) return;
      const { cur, g } = st;
      st = null;
      if (cur.x === g.x && cur.y === g.y && cur.w === g.w && cur.h === g.h) return;
      const isMap = node.classList.contains('sheet__map');
      // 地図はサイズ変更後に作り直す（Leaflet のサイズ再計算）。それ以外はインライン配置のまま保存だけ
      commit(M.setBlock(trip, tpl, node.dataset.block, cur), { rebuild: isMap });
      if (!isMap) renderPanel();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  function fitScale() {
    if (!sheet) return;
    const tpl = getTemplate(trip.templateId);
    const w = (tpl.orientation === 'landscape' ? 297 : 210) * MM;
    const hh = (tpl.orientation === 'landscape' ? 210 : 297) * MM;
    const avail = Math.max(200, viewport.clientWidth - 32);
    const scale = Math.min(1, avail / w);
    viewport.style.setProperty('--sheet-scale', String(scale));
    viewport.style.height = `${hh * scale + 32}px`;
  }

  root.replaceChildren(
    pageStyle,
    h('header', { class: 'topbar' },
      h('a', { class: 'btn btn--ghost', href: `#/trip/${trip.id}` }, '← 編集へ'),
      h('h1', { class: 'topbar__title' }, 'A4 プレビュー'),
      h('nav', { class: 'topbar__nav' }, statusEl, pngBtn, printBtn),
    ),
    h('main', { class: 'print-layout' }, panel, h('section', { class: 'print-stage' }, printNote, viewport)),
  );

  build();
  const ro = new ResizeObserver(fitScale);
  ro.observe(viewport);

  return () => {
    alive = false;
    ro.disconnect();
    if (map) map.destroy();
    for (const u of urls.values()) URL.revokeObjectURL(u);
  };
}
