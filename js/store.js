/*
 * store.js — IndexedDB ラッパ。trips / photos の 2 ストア。
 * 写真 Blob は Trip に埋め込まず photos ストアに置く。
 */

import { createTrip, validateTrip } from './model.js';

export const EXPORT_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function createStore(dbName = 'tabi-ato') {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('trips')) {
          db.createObjectStore('trips', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' });
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('データベースが他のタブで使用中です'));
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    const t = db.transaction(store, mode);
    const result = await fn(t.objectStore(store));
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    });
    return result;
  }

  return {
    name: dbName,

    async getAllTrips() {
      const trips = await tx('trips', 'readonly', (s) => req(s.getAll()));
      return trips.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    getTrip(id) {
      return tx('trips', 'readonly', (s) => req(s.get(id)));
    },
    /**
     * @param {object} trip
     * @param {{ expectUpdatedAt?: string|null }} [opts]
     *   expectUpdatedAt を渡すと、保存済みの updatedAt が一致しないとき ConflictError、
     *   保存済みが無ければ（別タブで削除済み）DeletedError を投げる（同一トランザクション内で判定）。
     */
    putTrip(trip, { expectUpdatedAt } = {}) {
      const errors = validateTrip(trip);
      if (errors.length) return Promise.reject(new Error(errors.join(' / ')));
      return tx('trips', 'readwrite', async (s) => {
        if (expectUpdatedAt !== undefined) {
          const cur = await req(s.get(trip.id));
          if (!cur) throw Object.assign(new Error('この旅は別のタブで削除されています'), { code: 'deleted' });
          if (cur.updatedAt !== expectUpdatedAt) throw Object.assign(new Error('別のタブで変更されています'), { code: 'conflict', current: cur });
        }
        return req(s.put(trip));
      });
    },
    async deleteTrip(id) {
      const trip = await this.getTrip(id);
      if (trip) {
        const ids = new Set(trip.visits.flatMap((v) => v.photoIds));
        for (const pid of ids) await this.deletePhoto(pid);
      }
      return tx('trips', 'readwrite', (s) => req(s.delete(id)));
    },

    putPhoto(photo) {
      return tx('photos', 'readwrite', (s) => req(s.put(photo)));
    },
    getPhoto(id) {
      return tx('photos', 'readonly', (s) => req(s.get(id)));
    },
    deletePhoto(id) {
      return tx('photos', 'readwrite', (s) => req(s.delete(id)));
    },
    getAllPhotos() {
      return tx('photos', 'readonly', (s) => req(s.getAll()));
    },

    /** 全データを 1 つの JSON オブジェクトへ（写真は base64） */
    async exportAll() {
      const trips = await this.getAllTrips();
      const photos = {};
      for (const p of await this.getAllPhotos()) {
        photos[p.id] = {
          mime: p.blob.type || 'image/jpeg',
          base64: await blobToBase64(p.blob),
          thumb: p.thumb ?? null,
          width: p.width,
          height: p.height,
          createdAt: p.createdAt,
        };
      }
      return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), trips, photos };
    },

    /** Export 形式を取り込む。同じ id は上書き。version 不一致は拒否 */
    async importAll(data) {
      if (!data || data.version !== EXPORT_VERSION) {
        throw new Error(`このファイルは読み込めません（version ${data?.version ?? '不明'}。対応は ${EXPORT_VERSION}）`);
      }
      if (!Array.isArray(data.trips)) throw new Error('旅のデータ（trips）がありません。旅あとで書き出したファイルを選んでください');
      if (data.photos != null && (typeof data.photos !== 'object' || Array.isArray(data.photos))) throw new Error('写真のデータ（photos）の形式が不正です');
      const trips = data.trips.map((t) => createTrip(t));
      for (const t of trips) {
        const errors = validateTrip(t);
        if (errors.length) throw new Error(`「${t.title || t.id}」: ${errors.join(' / ')}`);
      }
      // 先に全写真をデコードしてから書き込む（途中失敗で中途半端な状態にしない）
      const photos = [];
      for (const [id, p] of Object.entries(data.photos || {})) {
        let blob;
        try { blob = base64ToBlob(p.base64, p.mime); } catch { throw new Error(`写真 ${id} のデータが壊れています`); }
        photos.push({ id, blob, thumb: p.thumb ?? null, width: p.width, height: p.height, createdAt: p.createdAt ?? new Date().toISOString() });
      }
      for (const ph of photos) await this.putPhoto(ph);
      for (const t of trips) await this.putTrip(t);
      return { trips: trips.length, photos: Object.keys(data.photos || {}).length };
    },

    async clear() {
      await tx('trips', 'readwrite', (s) => req(s.clear()));
      await tx('photos', 'readwrite', (s) => req(s.clear()));
    },

    async close() {
      if (!dbPromise) return;
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    },
  };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const store = createStore('tabi-ato');
