/*
 * route.js — OSRM 公開デモサーバーから道なり経路を取る。無料・無保証なので
 * 1 本ずつ直列に問い合わせ、失敗はその区間だけ直線に戻す（呼び出し側）。
 */

const ENDPOINT = 'https://router.project-osrm.org/route/v1';
let chain = Promise.resolve();

/**
 * @param {'driving'|'foot'} profile
 * @param {{lat,lng}} from
 * @param {{lat,lng}} to
 * @returns {Promise<Array<[number, number]>>} [lat, lng] の列
 */
export function fetchRoute(profile, from, to) {
  const run = async () => {
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${ENDPOINT}/${profile}/${coords}?overview=full&geometries=geojson`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal });
    } catch {
      throw new Error('経路サーバーに接続できませんでした');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`経路サーバーが応答しませんでした（HTTP ${res.status}）`);
    const json = await res.json();
    const line = json?.routes?.[0]?.geometry?.coordinates;
    if (json.code !== 'Ok' || !Array.isArray(line) || line.length < 2) throw new Error('この区間の経路が見つかりませんでした');
    return line.map(([lng, lat]) => [lat, lng]);
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
