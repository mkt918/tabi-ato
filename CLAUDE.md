# 旅あと — Claude への指示

このプロジェクトは **Phase 0（設計）を Opus が済ませ、以降は Sonnet / Haiku が実装する**前提で書いてある。
迷ったら README.md の「決めたこと」を正とし、設計を変えたくなったらユーザーに聞く（無言で変えない）。
進捗は `TASKS.md` にだけ記録する（README の状況欄は Phase 完了時に1行更新するのみ）。

## 絶対に守ること
- **ビルド無し・フレームワーク無し**。素の HTML / CSS / ES modules。npm も bundler も入れない
- 外部ライブラリは Leaflet 1.9.4 と html2canvas 1.4.1（PNG 書き出し用、2026-09-21 承認）の 2 つ（cdnjs、バージョン固定）。他を足したくなったらユーザーに理由を添えて確認
- html2canvas は oklch を解釈できない → `.sheet` 内の色は print.css で hex 固定。tokens.css の oklch を `.sheet` 内で使わない
- **従量課金 API を使わない**（Google Maps / Places 等は禁止）。Nominatim は 1 req/s 以下・入力確定時のみ
- 写真・データはブラウザ内（IndexedDB）のみ。サーバー・外部ストレージへ送らない
- ライトテーマのみ。ダークテーマは作らない（13_wavelength と同じ方針）
- `model.js` は DOM を触らない純粋関数だけにし、`tests.js` で網羅する
- 中間生成物・実験ファイルはこのフォルダに置かない（scratchpad へ）

## 作業の進め方
1. 着手前に `TASKS.md` を読み、今の Phase の未完了項目から選ぶ
2. 実装 → `tests.html` をブラウザで開いて全通過を確認（Claude Browser で開いて結果テキストを読む。スクリーンショットは不要）
3. UI 変更のプレビュー撮影は不要。ユーザーが自分のブラウザで確認する（ユーザー共通指示）
4. `TASKS.md` のチェックを更新し、Phase が終わったら README の「現在の状況」を1行直す
5. コミットはユーザーが頼んだときだけ

## 実装メモ（README の補足。ハマりどころ）
- **Leaflet のマーカー番号**：`L.divIcon` に `<span class="pin">1</span>` を入れる。画像アイコンは使わない（印刷で欠けやすい）
- **fitBounds** は訪問地が 1 点のときエラーになる → 1点なら `setView(latlng, 14)` に分岐
- **印刷ビューの地図**は編集画面と別インスタンスを作る。同じ DOM を使い回すと `invalidateSize` 地獄になる
- **タイル読み込み待ち**：`tileLayer.on('load', …)` で印刷ボタンを有効化。`load` は表示範囲の全タイル完了で1回発火する
- **IndexedDB**：`trips` と `photos` の 2 ストア。写真 Blob を Trip に埋め込まない（書き出し時にだけ base64 化）
- **画像縮小**：`createImageBitmap` → canvas → `toBlob('image/jpeg', 0.85)`。HEIC は Chrome 非対応なので「JPEG/PNG にしてください」と案内するだけでよい
- **Nominatim** のレスポンスは `display_name` が長い。表示は `name` があればそれ、無ければ `display_name` の先頭カンマ区切り 1 要素
- **A4 のブロック配置**：`.sheet` 内は grid ではなく `data-block` の絶対配置（mm、インライン style）。位置は `templates.js` の `blocks` 初期値 → `Trip.layout` 上書き。新テンプレを足すときは blocks と build() の data-block を一致させる
- **印刷ビューの操作**：`commit(next, {rebuild, history, animate})`。history は Ctrl+Z 用のスタック（'merge' で連打を 1 手に）。animate は FLIP（写真は photoId、他は block id で対応づけ）
- **道なりルート**：OSRM デモサーバー。区間キーは座標＋profile（`model.segmentKey`）。経路は Trip.routes に保存され、地点変更で prune → 不足分だけ再取得
- **A4 の実寸**：`.sheet { width:210mm; height:297mm; overflow:hidden }` を画面上では `transform: scale()` で縮小表示、印刷時は `transform:none`。`@media print { body > :not(.sheet) { display:none } }`
- **フォント**：Google Fonts は `<link>` で読む。印刷前に `document.fonts.ready` を待つ

## デザイン
- トークンは `hallmark` スキルで生成して `css/tokens.css` に置く。方向性：旅のしおり／スタンプ帳。紙っぽい生成りの地に、アクセントは深い青緑か朱の 1 色
- A4 テンプレは「印刷して手に取るもの」。画面UIより余白を多く、文字は 9pt 以上、写真は角丸最小限
- UI 文言は日本語、ですます調、短く。エラーは「何が起きたか＋次に何をすればよいか」

## テスト（tests.html）で最低限見ること
- `model.js`：Visit の追加・削除・並び替えで `order` が 0..n-1 に振り直される／日付順ソート／日別グルーピング／検証（lat/lng 範囲、date 形式）
- `store.js`：保存→読込の往復、Export→Import で同一（id 含む）、version 不一致時の拒否
- `templates.js`：3テンプレとも `photoSlots` 数どおり DOM が生成される／写真不足時は空スロット表示で落ちない
