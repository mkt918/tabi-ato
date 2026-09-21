/*
 * ui.js — 画面共通のヘルパ（要素生成・トースト・保存キュー）。
 */

import { store } from './store.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === false || v == null) continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const root = document.getElementById('app');

const toastEl = document.getElementById('toast');
let toastTimer = null;
export function toast(msg, kind = 'info') {
  toastEl.textContent = msg;
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, kind === 'error' ? 6000 : 2500);
}

export function navigate(hash) { location.hash = hash; }

/**
 * 保存は直列化し、失敗を画面に出す。
 * 楽観ロック：読み込んだ時点の updatedAt を基準に、別タブの変更・削除を検出する。
 * onConflict(kind, current) … kind は 'conflict' | 'deleted'
 */
export function makeSaver(statusEl, { baseUpdatedAt = undefined, onConflict = null } = {}) {
  let queue = Promise.resolve();
  let base = baseUpdatedAt;
  let stopped = false;
  const saver = (trip) => {
    if (stopped) return queue;
    statusEl.textContent = '保存中…';
    queue = queue.then(async () => {
      if (stopped) return;
      await store.putTrip(trip, { expectUpdatedAt: base });
      base = trip.updatedAt;
      statusEl.textContent = '保存済み';
    }).catch((e) => {
      if (stopped) return;
      if (e && (e.code === 'conflict' || e.code === 'deleted')) {
        stopped = true;
        statusEl.textContent = '保存できませんでした';
        toast(e.code === 'deleted' ? 'この旅は別のタブで削除されました。一覧に戻ります' : '別のタブで変更されていたため、最新の内容を読み込み直しました', 'error');
        if (onConflict) onConflict(e.code, e.current);
        return;
      }
      statusEl.textContent = '保存できませんでした';
      toast(`保存できませんでした：${e.message}`, 'error');
    });
    return queue;
  };
  saver.stop = () => { stopped = true; };
  saver.flush = () => queue;
  return saver;
}
