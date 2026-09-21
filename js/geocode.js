/*
 * geocode.js — Nominatim 検索。1 req/s 以下・同一クエリはキャッシュ。
 * 呼び出し側は入力確定（Enter or 600ms 無入力）でのみ呼ぶこと。
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL = 1100;
const cache = new Map();
let chain = Promise.resolve();
let lastAt = 0;

const SCOPE_KEY = 'tabiato.countrycodes';
/** 検索範囲：'jp'（既定）または ''（世界中） */
export function getSearchScope() {
  try { const v = localStorage.getItem(SCOPE_KEY); return v == null ? 'jp' : v; } catch { return 'jp'; }
}
export function setSearchScope(v) {
  try { localStorage.setItem(SCOPE_KEY, v); } catch { /* プライベートモード等では保存しない */ }
}

export function shortName(item) {
  if (item.name) return item.name;
  return String(item.display_name || '').split(',')[0].trim();
}

/**
 * @returns {Promise<Array<{name, displayName, lat, lng}>>}
 */
export function search(query, { countrycodes = getSearchScope(), limit = 6 } = {}) {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  const key = `${countrycodes}|${q}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  const run = async () => {
    const wait = Math.max(0, lastAt + MIN_INTERVAL - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const params = new URLSearchParams({ format: 'jsonv2', q, limit: String(limit), 'accept-language': 'ja' });
    if (countrycodes) params.set('countrycodes', countrycodes);
    let res;
    try {
      res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('検索サーバーに接続できませんでした。ネットワークを確認するか、地図をクリックして地点を置いてください');
    }
    if (!res.ok) throw new Error(`検索に失敗しました（HTTP ${res.status}）。少し待ってからもう一度お試しください`);
    let json;
    try { json = await res.json(); } catch { throw new Error('検索結果を読めませんでした。少し待ってからもう一度お試しください'); }
    const items = json.map((it) => ({
      name: shortName(it),
      displayName: it.display_name,
      lat: Number(it.lat),
      lng: Number(it.lon),
    }));
    cache.set(key, items);
    return items;
  };

  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}
