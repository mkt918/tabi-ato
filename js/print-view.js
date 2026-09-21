/*
 * print-view.js — 印刷ビュー #/print/<id>。
 * 左：調整パネル／右：A4 プレビュー（.sheet-viewport 内で縮小表示）。
 * 変更のたびに .sheet を作り直し、Leaflet も別インスタンスとして作り直す。
 *
 * 操作の種類
 *  - 通常モード：写真枠クリックで選択→バンクから入れる／枠を 2 回クリックで入替／
 *    写真の上でドラッグ＝見せ位置（枠の外まで引っ張ると別の枠へ移動＝入替）／バンクから枠へドラッグ
 *  - レイアウト調整モード：ブロックのドラッグ移動・右下ハンドルでリサイズ・吸着ガイド・矢印キー・数値入力
 *  - Ctrl+Z / Ctrl+Y：この画面で行った変更の取り消し・やり直し
 *  - テンプレ切替時：同じ写真・同種ブロックが旧位置から新位置へ動く（FLIP）
 */

import { store } from './store.js';
import * as M from './model.js';
import { createMap } from './map.js';
import { TEMPLATE_LIST, getTemplate, buildSheet, applyLayout, fitOverflow, captionForWidth } from './templates.js';
import { root, h, toast, makeSaver } from './ui.js';

const ACCENT_LABELS = { ai: '藍', shu: '朱', midori: '深緑', karashi: '芥子', budou: '葡萄' };
const FONT_LABELS = { gothic: 'ゴシック', mincho: '明朝', hand: '手書き風' };
const MM = 96 / 25.4; // 1mm の px
const SNAP = 3;       // 吸着距離 mm
const MARGIN = 12;    // 用紙余白 mm
const HISTORY_MAX = 50;
/** setPointerCapture は合成イベントや古い環境で投げることがあるので握りつぶす */
function capture(el, e) { try { el.setPointerCapture(e.pointerId); } catch { /* noop */ } }
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // -- 保存・履歴
  const statusEl = h('span', { class: 'save-status' }, '保存済み');
  let alive = true;
  const save = makeSaver(statusEl, {
    baseUpdatedAt: trip.updatedAt,
    onConflict: (kind) => { alive = false; if (kind === 'deleted') location.hash = '#/'; else location.reload(); },
  });
  const undoStack = [];
  const redoStack = [];
  let lastMerge = { key: null, at: 0 };
  /**
   * @param {object} next
   * @param {{ rebuild?: boolean, history?: boolean|string, animate?: boolean }} opts
   *   history に文字列を渡すと「同じキーの変更が 800ms 以内に続いた場合だけ」1 手にまとめる（矢印キー連打・文字入力）
   */
  const commit = (next, { rebuild = true, history = true, animate = false } = {}) => {
    if (!alive) return;
    if (history) {
      const now = Date.now();
      const key = typeof history === 'string' ? history : null;
      const merge = key && key === lastMerge.key && now - lastMerge.at < 800;
      if (!merge) {
        undoStack.push(trip);
        if (undoStack.length > HISTORY_MAX) undoStack.shift();
        redoStack.length = 0;
      }
      lastMerge = { key, at: now };
    }
    trip = next;
    save(trip);
    if (rebuild) build({ animate });
    else updateHistoryButtons();
  };
  function undo() { if (!undoStack.length) return; redoStack.push(trip); trip = undoStack.pop(); lastMerge = { key: null, at: 0 }; save(trip); build({ animate: true }); }
  function redo() { if (!redoStack.length) return; undoStack.push(trip); trip = redoStack.pop(); lastMerge = { key: null, at: 0 }; save(trip); build({ animate: true }); }
  const undoBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: '取り消し（Ctrl+Z）', disabled: true, onclick: undo }, '↶');
  const redoBtn = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', title: 'やり直し（Ctrl+Y）', disabled: true, onclick: redo }, '↷');
  function updateHistoryButtons() { undoBtn.disabled = undoStack.length === 0; redoBtn.disabled = redoStack.length === 0; }

  // -- 印刷・PNG ボタン（タイル load ＋ フォント ready で有効化）
  const printBtn = h('button', { class: 'btn btn--primary', type: 'button', disabled: true, onclick: () => window.print() }, '印刷 / PDF 保存');
  const printNote = h('p', { class: 'hint print-note' }, '印刷ダイアログで「背景のグラフィック」をオンにしてください。用紙は A4・余白なし。PNG は Canva などに読み込んで飾り付けに使えます。');
  const pngBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: async (e) => {
    if (typeof html2canvas === 'undefined') { toast('画像化ライブラリを読み込めませんでした。ネットワークを確認して再読み込みしてください', 'error'); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '作成中…';
    const prevScale = viewport.style.getPropertyValue('--sheet-scale');
    viewport.style.setProperty('--sheet-scale', '1');
    try {
      const canvas = await html2canvas(sheet, { useCORS: true, scale: 2, backgroundColor: null, logging: false,
        // html2canvas は oklch を解釈できない。複製側の body だけ hex にする（.sheet 内は print.css で hex 固定）
        onclone: (doc) => {
          doc.body.style.background = '#fff'; doc.body.style.color = '#000';
          doc.querySelectorAll('.slot--empty, .guide').forEach((n) => n.remove());
          doc.querySelector('.sheet')?.classList.remove('sheet--layout');
          doc.querySelectorAll('.slot--selected, .block--active').forEach((n) => n.classList.remove('slot--selected', 'block--active'));
        } });
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
  let selectedSlot = null;   // 通常モード：選択中の写真枠
  let layoutMode = false;    // レイアウト調整モード
  let activeBlock = null;    // レイアウト調整：選択中のブロック id
  const panel = h('aside', { class: 'print-panel' });

  function templateTile(t) {
    // blocks から描くミニプレビュー（0.22px/mm）
    const S = M.SHEET_MM[t.orientation];
    const k = 0.22;
    const mini = h('div', { class: 'tile__mini', style: `width:${S.w * k}px;height:${S.h * k}px` },
      ...t.blocks.map((b) => h('span', { class: `tile__b tile__b--${b.kind}`,
        style: `left:${b.x * k}px;top:${b.y * k}px;width:${b.w * k}px;height:${b.h * k}px` })));
    return h('button', { class: 'tile', type: 'button', 'aria-pressed': String(t.id === trip.templateId), title: t.name,
      onclick: () => { if (t.id === trip.templateId) return; selectedSlot = null; activeBlock = null; commit(M.touch({ ...trip, templateId: t.id }), { animate: true }); } },
      mini, h('span', { class: 'tile__name' }, t.name), h('span', { class: 'tile__meta' }, `写真 ${t.photoSlots}`));
  }

  function renderPanel() {
    const tpl = getTemplate(trip.templateId);
    const slots = M.resolveSlots(trip, tpl);
    const inSlot = new Set(slots.filter(Boolean));
    const customized = !!trip.layout?.[tpl.id];
    const layout = M.resolveLayout(trip, tpl);
    const g = activeBlock ? layout[activeBlock] : null;
    const num = (key, label) => h('label', { class: 'num' }, h('span', {}, label),
      h('input', { type: 'number', class: 'input input--num', min: 0, max: 297, step: 1, value: g ? g[key] : '',
        onchange: (e) => {
          if (!g) return;
          const isMap = activeBlock === 'map';
          const captionChanged = activeBlock.startsWith('slot-') && captionForWidth(g.w) !== captionForWidth(Number(key === 'w' ? e.target.value : g.w));
          commit(M.setBlock(trip, tpl, activeBlock, { ...g, [key]: Number(e.target.value) }), { rebuild: isMap || captionChanged, history: `num:${activeBlock}:${key}` });
          if (!isMap && !captionChanged) { applyLayout(sheet, M.resolveLayout(trip, tpl)); renderPanel(); }
        } }));

    panel.replaceChildren(
      h('div', { class: 'field layout-field' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: layoutMode,
          onchange: (e) => { layoutMode = e.target.checked; selectedSlot = null; activeBlock = null; build(); } }), ' レイアウト調整'),
        h('p', { class: 'hint' }, layoutMode
          ? 'ドラッグで移動、右下の四角で大きさを変更。近くの枠や余白に吸着します。矢印キーで 1mm（Shift で 5mm）。'
          : 'オンにすると、タイトル・地図・地点一覧・写真枠の位置と大きさを変えられます。Ctrl+Z で取り消し。'),
        layoutMode && g ? h('div', { class: 'num-row' }, num('x', 'X'), num('y', 'Y'), num('w', '幅'), num('h', '高さ')) : null,
        h('button', { class: 'btn btn--sm', type: 'button', disabled: !customized, onclick: () => {
          if (confirm('このテンプレートの配置を初期状態に戻します。よろしいですか？')) { activeBlock = null; commit(M.resetLayout(trip, tpl), { animate: true }); }
        } }, 'テンプレの初期配置に戻す'),
      ),
      field('テンプレート（縦）', h('div', { class: 'tiles' }, ...TEMPLATE_LIST.filter((t) => t.orientation === 'portrait').map(templateTile))),
      field('テンプレート（横）', h('div', { class: 'tiles' }, ...TEMPLATE_LIST.filter((t) => t.orientation === 'landscape').map(templateTile))),
      field('アクセント', h('div', { class: 'choice-row' },
        ...M.ACCENTS.map((a) => h('button', { class: `swatch swatch--${a}`, type: 'button', title: ACCENT_LABELS[a], 'aria-label': ACCENT_LABELS[a],
          'aria-pressed': String(a === trip.theme.accent),
          onclick: () => commit(M.touch({ ...trip, theme: { ...trip.theme, accent: a } })) })))),
      field('フォント', h('div', { class: 'choice-row' },
        ...M.FONTS.map((f) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(f === trip.theme.font),
          onclick: () => commit(M.touch({ ...trip, theme: { ...trip.theme, font: f } })) }, FONT_LABELS[f])))),
      field('タイトル', h('input', { type: 'text', class: 'input', value: trip.title, placeholder: '旅の記録',
        oninput: (e) => { commit(M.touch({ ...trip, title: e.target.value }), { rebuild: false, history: 'title' }); patchText(); } })),
      field('サブタイトル', h('input', { type: 'text', class: 'input', value: trip.subtitle, placeholder: '例：家族で、春の京都',
        oninput: (e) => { commit(M.touch({ ...trip, subtitle: e.target.value }), { rebuild: false, history: 'subtitle' }); patchText(); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: trip.showDates,
        onchange: (e) => commit(M.touch({ ...trip, showDates: e.target.checked })) }), ' 期間を表示'),
      field('地図', h('div', { class: 'choice-row' },
        ...M.MAP_STYLES.map((val) => [val, M.MAP_STYLE_LABELS[val]]).map(([val, label]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(val === trip.mapStyle),
          onclick: () => commit(M.touch({ ...trip, mapStyle: val })) }, label)))),
      field(`写真（${tpl.photoSlots} 枠）`, h('div', {},
        h('p', { class: 'hint' }, layoutMode
          ? 'レイアウト調整中は写真の入替はできません。'
          : selectedSlot == null
            ? '写真をドラッグして別の枠に落とすと入れ替え。ここの写真を枠へドラッグして入れることもできます。写真の上で軽くドラッグすると見せる位置を調整。'
            : `枠 ${selectedSlot + 1} を選択中。写真をクリックで入れます。`),
        h('div', { class: 'photo-bank' },
          ...M.allPhotoIds(trip).map((pid) => {
            const owner = M.visitOfPhoto(trip, pid);
            const item = h('button', { class: 'bank-item' + (inSlot.has(pid) ? ' bank-item--used' : ''), type: 'button', title: owner?.name || '',
              disabled: layoutMode,
              onclick: () => { if (dragMoved) return; if (selectedSlot != null) commit(M.setSlot(trip, tpl, selectedSlot, pid), { animate: true }); } },
              h('img', { src: thumbs.get(pid), alt: '', draggable: 'false' }),
              owner ? h('span', { class: 'bank-item__no' }, String(owner.order + 1)) : null);
            if (!layoutMode) attachBankDrag(item, pid, tpl);
            return item;
          }),
          M.allPhotoIds(trip).length === 0 ? h('p', { class: 'hint' }, '写真はまだありません。編集画面で訪問地に追加できます。') : null,
        ),
        selectedSlot != null && slots[selectedSlot] ? h('button', { class: 'btn btn--sm', type: 'button',
          onclick: () => commit(M.setSlot(trip, tpl, selectedSlot, null)) }, `枠 ${selectedSlot + 1} を空にする`) : null,
      )),
    );
    updateHistoryButtons();
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
  const sheetScale = () => Number(viewport.style.getPropertyValue('--sheet-scale')) || 1;

  /** FLIP 用：写真は photoId、他ブロックは id で位置を記録 */
  const flipKey = (node) => (node.classList.contains('slot') ? (node.dataset.photo ? `p:${node.dataset.photo}` : null) : `b:${node.dataset.block}`);
  function snapshotRects() {
    const out = new Map();
    if (!sheet) return out;
    for (const node of sheet.querySelectorAll(':scope > [data-block]')) {
      const key = flipKey(node);
      if (key) out.set(key, node.getBoundingClientRect());
    }
    return out;
  }
  function playFlip(before) {
    if (!before.size || reducedMotion()) return;
    const scale = sheetScale();
    for (const node of sheet.querySelectorAll(':scope > [data-block]')) {
      const key = flipKey(node);
      const from = key && before.get(key);
      if (!from) { node.classList.add('block--enter'); continue; }
      const to = node.getBoundingClientRect();
      const dx = (from.left - to.left) / scale, dy = (from.top - to.top) / scale;
      const sx = from.width / Math.max(1, to.width), sy = from.height / Math.max(1, to.height);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      node.style.transition = 'none';
      node.style.transformOrigin = 'top left';
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      node.classList.add('block--flip');
    }
    void sheet.offsetWidth; // reflow してから遷移を開始
    for (const node of sheet.querySelectorAll('.block--flip')) {
      node.style.transition = 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1)';
      node.style.transform = '';
      node.addEventListener('transitionend', () => { node.classList.remove('block--flip'); node.style.transition = ''; node.style.transformOrigin = ''; }, { once: true });
    }
  }

  function build({ animate = false } = {}) {
    const before = animate ? snapshotRects() : new Map();
    hideGhost(); dragMoved = false; // ドラッグ中に build（Ctrl+Z など）されても残骸を残さない
    if (map) { map.destroy(); map = null; }
    const tpl = getTemplate(trip.templateId);
    if (selectedSlot != null && selectedSlot >= tpl.photoSlots) selectedSlot = null;
    if (activeBlock && !tpl.blocks.some((b) => b.id === activeBlock)) activeBlock = null;
    const slots = M.resolveSlots(trip, tpl);
    sheet = buildSheet(trip, tpl, slots, photoUrl);
    pageStyle.textContent = `@page { size: A4 ${tpl.orientation}; margin: 0; }`;
    viewport.replaceChildren(sheet);
    fitScale();
    fitOverflow(sheet); // 地点一覧・タイムラインが溢れたら縮めて「他 n 地点」に寄せる
    playFlip(before);

    // 地図（別インスタンス・操作無効）
    const mapEl = sheet.querySelector('.sheet__map');
    printBtn.disabled = true;
    pngBtn.disabled = true;
    const seq = ++buildSeq;
    if (mapEl) {
      map = createMap(mapEl, { style: trip.mapStyle, interactive: false, canvas: true, color: getComputedStyle(sheet).getPropertyValue('--sheet-accent').trim() || undefined });
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
      sheet.querySelectorAll(':scope > [data-block]').forEach((node) => {
        attachBlockDrag(node, tpl);
        if (node.dataset.block === activeBlock) node.classList.add('block--active');
      });
      renderPanel();
      return;
    }

    // 通常モード：スロット選択・入替・写真ドラッグ
    sheet.querySelectorAll('.slot').forEach((fig) => {
      const i = Number(fig.dataset.slot);
      if (i === selectedSlot) fig.classList.add('slot--selected');
      fig.addEventListener('click', () => {
        if (dragMoved) return;
        if (selectedSlot == null || selectedSlot === i) { selectedSlot = selectedSlot === i ? null : i; }
        else { const a = selectedSlot; selectedSlot = null; commit(M.swapSlots(trip, tpl, a, i), { animate: true }); return; }
        sheet.querySelectorAll('.slot--selected').forEach((x) => x.classList.remove('slot--selected'));
        if (selectedSlot != null) fig.classList.add('slot--selected');
        renderPanel();
      });
      const img = fig.querySelector('.slot__img');
      if (img) attachPhotoDrag(img, fig, tpl);
    });
    renderPanel();
  }

  // ---- 写真のドラッグ：枠内＝見せ位置、枠外へ出たら別の枠への移動（入替） ----
  let dragMoved = false;
  let ghost = null;
  function slotUnderPointer(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el ? el.closest('.sheet .slot') : null;
  }
  function showGhost(src, e) {
    if (!ghost) { ghost = h('img', { class: 'drag-ghost', src, alt: '' }); document.body.append(ghost); }
    ghost.style.left = `${e.clientX}px`; ghost.style.top = `${e.clientY}px`;
  }
  function hideGhost() { if (ghost) { ghost.remove(); ghost = null; } sheet?.querySelectorAll('.slot--drop').forEach((x) => x.classList.remove('slot--drop')); }
  function markDrop(target, source) {
    sheet.querySelectorAll('.slot--drop').forEach((x) => x.classList.remove('slot--drop'));
    if (target && target !== source) target.classList.add('slot--drop');
  }

  function attachPhotoDrag(img, fig, tpl) {
    const pid = fig.dataset.photo;
    let st = null;
    img.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const pos = trip.photoPos[pid] || { x: 50, y: 50 };
      st = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, mode: 'pos', cur: null, rect: fig.getBoundingClientRect() };
      dragMoved = false;
      capture(img, e);
      e.preventDefault();
    });
    img.addEventListener('pointermove', (e) => {
      if (!st) return;
      if (Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > 3) dragMoved = true;
      const outside = e.clientX < st.rect.left - 8 || e.clientX > st.rect.right + 8 || e.clientY < st.rect.top - 8 || e.clientY > st.rect.bottom + 8;
      if (st.mode === 'pos' && outside) {
        st.mode = 'move';
        img.style.objectPosition = `${st.px}% ${st.py}%`; st.cur = null;
        fig.classList.add('slot--dragging');
      }
      if (st.mode === 'move') {
        showGhost(thumbs.get(pid) || img.src, e);
        markDrop(slotUnderPointer(e), fig);
        return;
      }
      const r = img.getBoundingClientRect();
      const dx = (e.clientX - st.x) / Math.max(1, r.width) * 100;
      const dy = (e.clientY - st.y) / Math.max(1, r.height) * 100;
      const x = Math.max(0, Math.min(100, st.px - dx * 1.5));
      const y = Math.max(0, Math.min(100, st.py - dy * 1.5));
      img.style.objectPosition = `${x}% ${y}%`;
      st.cur = { x, y };
    });
    const end = (e) => {
      if (!st) return;
      const s = st; st = null;
      fig.classList.remove('slot--dragging');
      if (s.mode === 'move') {
        const target = slotUnderPointer(e);
        hideGhost();
        if (target && target !== fig) commit(M.swapSlots(trip, tpl, Number(fig.dataset.slot), Number(target.dataset.slot)), { animate: true });
      } else if (s.cur) {
        commit(M.touch({ ...trip, photoPos: { ...trip.photoPos, [pid]: { x: Math.round(s.cur.x), y: Math.round(s.cur.y) } } }), { rebuild: false });
      }
      setTimeout(() => { dragMoved = false; }, 0);
    };
    img.addEventListener('pointerup', end);
    img.addEventListener('pointercancel', () => { hideGhost(); fig.classList.remove('slot--dragging'); st = null; });
  }

  /** 写真バンク → 枠へのドラッグ */
  function attachBankDrag(item, pid, tpl) {
    let st = null;
    item.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      st = { x: e.clientX, y: e.clientY, moving: false };
      dragMoved = false;
      capture(item, e);
    });
    item.addEventListener('pointermove', (e) => {
      if (!st) return;
      if (!st.moving && Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > 6) { st.moving = true; dragMoved = true; }
      if (!st.moving) return;
      showGhost(thumbs.get(pid), e);
      markDrop(slotUnderPointer(e), null);
    });
    const end = (e) => {
      if (!st) return;
      const moving = st.moving; st = null;
      if (!moving) return;
      const target = slotUnderPointer(e);
      hideGhost();
      if (target) commit(M.setSlot(trip, tpl, Number(target.dataset.slot), pid), { animate: true });
      setTimeout(() => { dragMoved = false; }, 0);
    };
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', () => { hideGhost(); st = null; });
  }

  // ---- レイアウト調整：ブロックのドラッグ移動・右下ハンドルでリサイズ・吸着 ----
  function snapCandidates(tpl, layout, exceptId) {
    const S = M.SHEET_MM[tpl.orientation];
    const xs = [0, MARGIN, S.w - MARGIN, S.w];
    const ys = [0, MARGIN, S.h - MARGIN, S.h];
    for (const [bid, g] of Object.entries(layout)) {
      if (bid === exceptId) continue;
      xs.push(g.x, g.x + g.w);
      ys.push(g.y, g.y + g.h);
    }
    return { xs, ys };
  }
  /** 値 v に最も近い候補が SNAP 以内ならそれを返す */
  function snapTo(v, list) {
    let best = null;
    for (const c of list) { const d = Math.abs(c - v); if (d <= SNAP && (best == null || d < Math.abs(best - v))) best = c; }
    return best;
  }
  function showGuides(lines) {
    sheet.querySelectorAll('.guide').forEach((g) => g.remove());
    for (const l of lines) {
      const g = h('div', { class: 'guide guide--' + l.dir });
      if (l.dir === 'v') g.style.left = `${l.at}mm`; else g.style.top = `${l.at}mm`;
      sheet.append(g);
    }
  }

  function attachBlockDrag(node, tpl) {
    const HANDLE = 6; // mm
    let st = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const layout = M.resolveLayout(trip, tpl);
      const g = layout[node.dataset.block];
      const scale = sheetScale();
      const r = node.getBoundingClientRect();
      const mmX = (e.clientX - r.left) / (MM * scale);
      const mmY = (e.clientY - r.top) / (MM * scale);
      const resize = mmX > g.w - HANDLE && mmY > g.h - HANDLE;
      st = { x: e.clientX, y: e.clientY, g, scale, resize, cur: g, cand: snapCandidates(tpl, layout, node.dataset.block) };
      setActiveBlock(node.dataset.block);
      capture(node, e);
      e.preventDefault();
      e.stopPropagation();
    });
    node.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = (e.clientX - st.x) / (MM * st.scale);
      const dy = (e.clientY - st.y) / (MM * st.scale);
      let next;
      const guides = [];
      if (st.resize) {
        next = { ...st.g, w: st.g.w + dx, h: st.g.h + dy };
        const sx = snapTo(next.x + next.w, st.cand.xs); if (sx != null) { next.w = sx - next.x; guides.push({ dir: 'v', at: sx }); }
        const sy = snapTo(next.y + next.h, st.cand.ys); if (sy != null) { next.h = sy - next.y; guides.push({ dir: 'h', at: sy }); }
      } else {
        next = { ...st.g, x: st.g.x + dx, y: st.g.y + dy };
        const l = snapTo(next.x, st.cand.xs), rgt = snapTo(next.x + next.w, st.cand.xs);
        if (l != null) { next.x = l; guides.push({ dir: 'v', at: l }); }
        else if (rgt != null) { next.x = rgt - next.w; guides.push({ dir: 'v', at: rgt }); }
        const t = snapTo(next.y, st.cand.ys), btm = snapTo(next.y + next.h, st.cand.ys);
        if (t != null) { next.y = t; guides.push({ dir: 'h', at: t }); }
        else if (btm != null) { next.y = btm - next.h; guides.push({ dir: 'h', at: btm }); }
      }
      st.cur = M.clampBlock(next, tpl.orientation);
      applyLayout(sheet, { [node.dataset.block]: st.cur });
      showGuides(guides);
    });
    const end = () => {
      if (!st) return;
      const { cur, g } = st;
      st = null;
      showGuides([]);
      if (cur.x === g.x && cur.y === g.y && cur.w === g.w && cur.h === g.h) return;
      const isMap = node.dataset.block === 'map';
      const captionChanged = node.classList.contains('slot') && captionForWidth(g.w) !== captionForWidth(cur.w);
      // 地図はサイズ変更後に作り直す（Leaflet のサイズ再計算）。キャプション種別が変わる幅なら再構築。それ以外は配置の保存だけ
      commit(M.setBlock(trip, tpl, node.dataset.block, cur), { rebuild: isMap || captionChanged });
      if (!isMap && !captionChanged) { fitOverflow(sheet); renderPanel(); }
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }
  function setActiveBlock(id) {
    activeBlock = id;
    sheet.querySelectorAll('.block--active').forEach((x) => x.classList.remove('block--active'));
    const node = sheet.querySelector(`[data-block="${id}"]`);
    if (node) node.classList.add('block--active');
    renderPanel();
  }

  // ---- キーボード：Ctrl+Z / Ctrl+Y、矢印キーでブロック移動 ----
  function onKey(e) {
    const inField = !!(e.target.closest && e.target.closest('input, textarea, select'));
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { if (inField) return; e.preventDefault(); undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { if (inField) return; e.preventDefault(); redo(); return; }
    }
    if (!layoutMode || !activeBlock || inField) return;
    const step = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const tpl = getTemplate(trip.templateId);
    const g = M.resolveLayout(trip, tpl)[activeBlock];
    commit(M.setBlock(trip, tpl, activeBlock, { ...g, x: g.x + d[0], y: g.y + d[1] }), { rebuild: false, history: `arrow:${activeBlock}` });
    applyLayout(sheet, M.resolveLayout(trip, tpl));
    renderPanel();
  }
  document.addEventListener('keydown', onKey);

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
      h('nav', { class: 'topbar__nav' }, undoBtn, redoBtn, statusEl, pngBtn, printBtn),
    ),
    h('main', { class: 'print-layout' }, panel, h('section', { class: 'print-stage' }, printNote, viewport)),
  );

  build();
  const ro = new ResizeObserver(fitScale);
  ro.observe(viewport);

  return () => {
    alive = false;
    document.removeEventListener('keydown', onKey);
    hideGhost();
    ro.disconnect();
    if (map) map.destroy();
    for (const u of urls.values()) URL.revokeObjectURL(u);
    return save.flush();
  };
}
