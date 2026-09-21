/*
 * photo.js — 画像の縮小（長辺 1600px / JPEG 0.85）とサムネ生成（320px）。
 */

import { uid } from './model.js';

const MAX_EDGE = 1600;
const THUMB_EDGE = 320;
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function fit(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

function draw(bitmap, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  return c;
}

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality);
  });
}

/**
 * @param {File} file
 * @returns {Promise<{id, blob, thumb, width, height, createdAt}>}
 */
export async function processImage(file) {
  if (!ACCEPT.includes(file.type)) {
    throw new Error(`「${file.name}」は読み込めない形式です。JPEG か PNG にしてから選んでください（HEIC は非対応）`);
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`「${file.name}」を画像として開けませんでした。別の写真をお試しください`);
  }
  try {
    const [w, h] = fit(bitmap.width, bitmap.height, MAX_EDGE);
    const main = draw(bitmap, w, h);
    const [tw, th] = fit(w, h, THUMB_EDGE);
    const thumbCanvas = draw(main, tw, th);
    const blob = await toBlob(main, 0.85);
    const thumb = thumbCanvas.toDataURL('image/jpeg', 0.7);
    return { id: uid(), blob, thumb, width: w, height: h, createdAt: new Date().toISOString() };
  } finally {
    bitmap.close();
  }
}
