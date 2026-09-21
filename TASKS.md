# TASKS — 旅あと

進捗の唯一の記録元。状態：`未` / `着手` / `完了(日付)` / `保留(理由)`。

## Phase 0 設計 — 完了 2026-09-21
## CP2 縦切り — 完了 2026-09-21（一覧 → 編集 → 検索/クリック追加 → IndexedDB 保存 → リロード復元、tests 16/16）

## Phase 1 データ層＋編集画面＋地図

| # | 内容 | 完了条件 | 触ってよいファイル | 状態 |
|---|---|---|---|---|
| 1 | `photo.js`：画像縮小（長辺1600px / JPEG 0.85）とサムネ生成（320px） | File → `{blob, thumb, width, height}` を返す。HEIC 等の非対応形式は日本語エラー | js/photo.js | 完了(2026-09-21) |
| 2 | 訪問地に写真複数添付・削除・コメント入力・移動手段選択 | 写真は photos ストアへ、Visit.photoIds に id。削除時に photos からも消える。コメントと移動手段が保存される | js/app.js, css/style.css | 完了(2026-09-21) |
| 3 | 訪問地リストのドラッグ並び替え（HTML5 D&D。▲▼は残す） | ドロップで order が振り直され、線がつなぎ直る | js/app.js, css/style.css | 完了(2026-09-21) |
| 4 | 地図スタイル切替（標準/淡色）を編集画面に置く | 切替が Trip.mapStyle に保存され、リロード後も維持 | js/app.js, css/style.css | 完了(2026-09-21) |
| 5 | 受け入れ：旅を作り 5 地点置き、線が引かれ、リロード後も残る。tests 全通過 | 手動確認＋tests.html 全通過 | — | 完了(2026-09-21) |

## Phase 2 印刷ビュー＋テンプレ

| # | 内容 | 完了条件 | 触ってよいファイル | 状態 |
|---|---|---|---|---|
| 6 | `css/print.css`：`.sheet` A4 実寸、`@page`、画面上は scale 縮小、`@media print` で sheet 以外を隠す | 縦・横どちらも Chrome の印刷プレビューで 1 枚に収まる | css/print.css | 完了(2026-09-21) |
| 7 | `templates.js`：スロット定義（`{id,name,orientation,photoSlots,textSlots,maxVisits}`）と `buildSheet(trip, photos, tpl)` の骨格 ＋ tests | 3 定義が存在し、写真不足でも空スロットで落ちない。tests 追加 | js/templates.js, js/tests.js | 完了(2026-09-21) |
| 8 | テンプレ `map-hero`（縦、地図 2/3 ＋ 写真 3 枚）— **手本** | 印刷ビューで地図・ルート・写真・タイトルが描画される | js/templates.js, css/print.css | 完了(2026-09-21) |
| 9 | テンプレ `photo-grid`（縦、地図 1/3 ＋ 写真 6 枚グリッド） — sonnet 委譲 | #8 と同じ構造で描画される | js/templates.js, css/print.css | 完了(2026-09-21 sonnet) |
| 10 | テンプレ `route-timeline`（横、左地図 ＋ 右タイムライン） — sonnet 委譲 | #8 と同じ構造で描画される。横向きで 1 枚 | js/templates.js, css/print.css | 完了(2026-09-21 sonnet) |
| 11 | 印刷ビュー画面 `#/print/<id>`：別インスタンス地図（操作無効）、タイル load 待ちで印刷ボタン有効化、「背景のグラフィック」注記 | 印刷ボタンがタイル完了後に有効になり、`window.print()` で A4 1 枚 | js/app.js, js/print-view.js, js/ui.js, css/style.css | 完了(2026-09-21) |
| 12 | 軽い調整 UI：テンプレ切替／写真スロット割当（クリックで入替）／object-position／アクセント 5 色／フォント 3 種／タイトル・サブタイトル編集／日付表示切替／地図スタイル | 各操作が Trip に保存され、プレビューに即反映 | js/print-view.js, css/print.css, css/style.css | 完了(2026-09-21) |
| 13 | 受け入れ：3 テンプレとも Chrome で A4 1 枚に収まり PDF 保存できる | 手動確認 | — | 完了(2026-09-21：はみ出し無しを自動確認。印刷ダイアログはユーザー確認待ち) |

## Phase 3 磨き・公開

| # | 内容 | 完了条件 | 触ってよいファイル | 状態 |
|---|---|---|---|---|
| 14 | 設定画面：JSON 書き出し／読み込み、version 不一致の案内、countrycodes 切替（localStorage） | 書き出し→別 DB へ読み込みで同一。不一致で日本語エラー | js/app.js, js/settings-view.js, js/geocode.js | 完了(2026-09-21) |
| 15 | PNG 書き出し（html2canvas）→ Canva 手動ルートの案内文 — **着手前にライブラリ追加を確認** | PNG がダウンロードされる | js/print-view.js, index.html | 完了(2026-09-21 ユーザー承認で html2canvas 1.4.1 追加) |
| 16 | 写真の見せ位置のドラッグ調整（object-position） | ドラッグで位置が変わり保存される | js/print-view.js | 完了(2026-09-21) |
| 17 | 空状態・エラー文言・ローディング表示の整え | 全画面で空状態と失敗時の案内がある | js/*.js | 完了(2026-09-21) |
| 18 | 検証：Opus サブエージェントによる診断 → 再現する指摘を修正 | 報告と修正結果を TASKS.md 末尾に記録 | 全ファイル | 完了(2026-09-21) |
| 19 | CP3 公開：git init → gh repo create → GitHub Pages → README に URL | 公開 URL で一通り動く | README.md | 着手 |

## Phase 4 将来（都度判断）
- 自由配置編集／道なりルート（OSRM）／Canva 連携／クラウド同期／EXIF 回転補正（崩れたら）

## 診断記録（2026-09-21、Opus サブエージェント。17 件）

修正した指摘（再現手順が成立したもの）
1. 複製が写真を共有 → 写真も複製して独立させた（app.js 複製）
2. JSON に thumb が無く読み込み後に「写真なし」→ thumb を書き出し／読み込み（store.js）
3. 画面離脱後の写真処理が古い trip で保存 → `alive` フラグで中断（app.js）
4. 複数タブの last-write-wins → putTrip に楽観ロック（expectUpdatedAt）。競合時は最新を再読込して通知（store.js / ui.js）
5. 削除済みの旅が自動保存で復活 → 同上、削除検出で一覧へ戻す
6. 印刷が 2 ページ → 印刷時は sheet 以外を display:none、viewport の高さを解除（print.css）。print メディアで body の高さ＝sheet を確認
7. 開始日/終了日を空にすると以後保存不能 → 無効値は元に戻す（app.js）
8. 遷移の追い越しで古い画面が残る → route に世代カウンタ（app.js）
9. 番号バッジを一度押すと入力欄が選択できない → pointerup/cancel で解除（app.js）
10. Nominatim 不達で英語エラー → 日本語＋次の行動（geocode.js）
11. Enter で同一クエリ 2 回 → debounce を cancel（geocode.js / app.js）
12. 空の旅が溜まる → 一覧表示時に空の旅を削除（app.js）
13. タイル失敗でも印刷可 → tileerror を数えて警告（map.js / print-view.js）
15. 読み込みが非トランザクション → 全写真をデコードしてから書込。不正形式は日本語エラー（store.js / settings-view.js）
17. 写真を別枠へ移すと元枠が自動補充 → 移動元を「明示的に空」に（model.js）

直さない指摘（理由つき）
14. 印刷ビューを開いたまま別タブで足した写真が出ない → #4 の競合検出で最新を再読込するため実質解消。再読込で直る
16. iOS Safari の @page landscape 無視 → 環境依存で回避策なし。横長テンプレは PC の Chrome で印刷する前提（README に注記）。favicon 404 はコンソールのみ
