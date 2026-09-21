/*
 * settings-view.js — 設定画面 #/settings。JSON 書き出し／読み込み、検索範囲の切替。
 */

import { store } from './store.js';
import { getSearchScope, setSearchScope } from './geocode.js';
import { root, h, toast } from './ui.js';

export async function renderSettings() {
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });

  async function doExport(btn) {
    btn.disabled = true;
    status.textContent = '書き出し中…（写真が多いと数秒かかります）';
    try {
      const data = await store.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tabi-ato-${data.exportedAt.slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      status.textContent = `書き出しました（旅 ${data.trips.length} 件・写真 ${Object.keys(data.photos).length} 枚）。`;
    } catch (e) {
      status.textContent = '';
      toast(`書き出せませんでした：${e.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function doImport(file) {
    status.textContent = '読み込み中…';
    try {
      const text = await file.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('JSON として読めません。旅あとで書き出したファイルを選んでください'); }
      if (!data || !Array.isArray(data.trips)) throw new Error('旅あとで書き出したファイルではないようです（trips がありません）');
      const existing = await store.getAllTrips();
      const dup = data.trips.filter((t) => existing.some((e) => e.id === t.id)).length;
      if (dup > 0 && !confirm(`同じ旅が ${dup} 件あります。ファイルの内容で上書きしますか？`)) { status.textContent = '読み込みを取りやめました。'; return; }
      const r = await store.importAll(data);
      status.textContent = `読み込みました（旅 ${r.trips} 件・写真 ${r.photos} 枚）。一覧に戻ると表示されます。`;
    } catch (e) {
      status.textContent = '';
      toast(`読み込めませんでした：${e.message}`, 'error');
    }
  }

  const exportBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: (e) => doExport(e.currentTarget) }, 'JSON を書き出す');
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) doImport(f); } });
  const importBtn = h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'JSON を読み込む');

  const scope = getSearchScope();
  const scopeSel = h('select', { class: 'input', onchange: (e) => { setSearchScope(e.target.value); toast('検索範囲を変更しました'); } },
    h('option', { value: 'jp', selected: scope === 'jp' }, '日本国内のみ（既定）'),
    h('option', { value: '', selected: scope === '' }, '世界中'),
  );

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('a', { class: 'btn btn--ghost', href: '#/' }, '← 一覧'),
      h('h1', { class: 'topbar__title' }, '設定'),
    ),
    h('main', { class: 'page settings' },
      h('section', { class: 'card' },
        h('h2', { class: 'card__title' }, 'バックアップ・端末の移行'),
        h('p', {}, 'データはこのブラウザの中にだけ保存されています。別の端末で使うときや、ブラウザのデータを消す前に、JSON を書き出して保存してください。'),
        h('div', { class: 'btn-row' }, exportBtn, importBtn, fileInput),
        status,
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'card__title' }, '場所の検索範囲'),
        h('p', {}, '海外の旅を記録するときは「世界中」にします。'),
        scopeSel,
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'card__title' }, 'このサイトについて'),
        h('p', {}, '地図：国土地理院（淡色地図）、© OpenStreetMap contributors（OSMFJ タイル・標準タイル）。場所検索：Nominatim。写真・データは外部へ送信しません。'),
      ),
    ),
  );
  return () => {};
}
