# 旅あと（旅の軌跡をA4一枚に残すサイト）

日付と訪れた場所を時系列で入力すると、Googleマップのタイムラインのように地図上へ
ルートの線が引かれ、写真とコメントを添えて **A4 1枚の「旅の記録」として印刷** できる、
自分（＋家族）専用の Web サイト。サーバー無し・ビルド無し・ログイン無し。

> 名称は「旅あと」、リポジトリ名は `tabi-ato`（2026-09-21 確定）。

---

## 現在の状況（2026-09-21）

**Phase 1〜3 実装済み・診断修正済み。公開（CP3）待ち。** 進捗の正本は `TASKS.md`。

---

## 決めたこと（2026-09-21、ユーザー確認済み）

| 論点 | 決定 | 理由 |
|---|---|---|
| 利用者 | 自分＋家族のみ | ログイン・利用規約・クラウド保存が不要になり規模が1/3で済む |
| データ保存 | ブラウザ内（IndexedDB）＋ JSON 書き出し/読み込み | 無料・サーバー不要。端末を移すときはJSONを持ち運ぶ |
| 場所の入力 | 場所名検索（Nominatim）＋ 地図クリックの両方 | 名前のある場所は速く、無い場所（山中・海上）はクリックで置ける |
| A4編集の第1段階 | テンプレ差し込み＋軽い調整（写真入替・文字・色・フォント） | パワポ的な自由配置は開発量2〜3倍。構造だけ備えて Phase 4 へ |
| 地図 | Leaflet + OpenStreetMap タイル | Google Maps は従量課金。メモリ「API課金よりサブスク優先」に従う |
| 公開 | GitHub Pages（`mkt918.github.io/<repo>/`） | 10_ソート可視化・13_ウェーブレングスと同じ運用 |

### 却下・保留した案
- **Canva 連携で一発出力**：Canva Connect API はアプリ登録＋OAuthが必要で「サイトから一発」は割に合わない。
  代わりに ①A4をPNG書き出ししてCanvaへ手で読み込む（Phase 3）、②Claude側のCanva連携で入力データから直接生成する、の2ルートを残す。
- **クラウド同期（Firebase）**：スマホ入力→PC印刷は魅力だが、設定・保守の手間と引き換え。JSON書き出しで代替し、欲しくなったら Phase 4 で検討。
- **道なりルート（OSRM）**：Phase 1 は直線でつなぐ。見栄えが物足りなければ Phase 4 で無料の OSRM デモサーバーを検討。

---

## 使い方（完成イメージ）

1. **旅一覧** → 「新しい旅」でタイトル・期間を入れる
2. **編集画面**：左に訪問地リスト、右に地図
   - 「清水寺」と打つ → 候補から選ぶ → 日付を入れる → リストに追加、地図にピンと線が伸びる
   - 名前で出ない場所は地図をクリックしてピンを置き、名前を手入力
   - 各訪問地に写真（複数可）とひとことコメント
   - リストはドラッグで並び替え。線はリスト順（＝時系列）でつながる
3. **A4プレビュー**：テンプレを選ぶ → 写真をスロットへ割り当て → 色・フォントを選ぶ → 「印刷」
   - ブラウザの印刷ダイアログで「PDFに保存」または紙に印刷
4. **バックアップ**：設定画面から JSON 書き出し。別端末で読み込めば同じ状態になる

---

## 技術構成

```
15_旅あと/
├── index.html            … 単一ページ。ハッシュルーティングで4画面を切替
├── css/
│   ├── tokens.css        … デザイントークン（hallmark で生成。ライトのみ）
│   ├── style.css         … 画面UI
│   └── print.css         … A4 印刷レイアウト（@page size A4）＋テンプレ別CSS
├── js/
│   ├── app.js            … 画面遷移・イベント配線
│   ├── store.js          … IndexedDB ラッパ（trips / photos）、JSON 書き出し・読み込み
│   ├── model.js          … 純粋関数：Trip/Visit の生成・並び替え・検証・日別グルーピング
│   ├── geocode.js        … Nominatim 検索（debounce 600ms・1req/s・結果キャッシュ）
│   ├── map.js            … Leaflet 初期化・番号付きマーカー・ポリライン・fitBounds
│   ├── photo.js          … 画像リサイズ（長辺1600px/JPEG0.85）・サムネ生成（320px）
│   ├── templates.js      … テンプレ定義（スロット構成）と A4 DOM の組み立て
│   └── tests.js          … model / store / templates の単体テスト
├── tests.html            … ブラウザで開くとテストが走る（13_wavelength と同方式）
├── README.md / CLAUDE.md / TASKS.md
└── .nojekyll
```

- **ビルド無し**。外部ライブラリは Leaflet 1.9.x のみ CDN（cdnjs）から読む。
  ネイティブモジュール不要（メモリ「実機にビルドツール無し」に抵触しない）
- **ジオコーディング**：Nominatim（`https://nominatim.openstreetmap.org/search?format=jsonv2&q=…&accept-language=ja&countrycodes=jp`）。
  利用規約により **1リクエスト/秒以下・自動連打禁止**。入力確定（Enter or 600ms無入力）でのみ問い合わせ、同一クエリはキャッシュ。
  国内旅行が主なので `countrycodes=jp` を既定、設定で外せるようにする
- **地図タイル**：OSM 標準 ＋ 淡色（CartoDB Positron、帰属表示必須）。印刷では淡色の方が写真・文字が映える
- **写真**：IndexedDB に Blob で保存。読み込み時に長辺1600pxへ縮小するので、1旅20枚でも数MBに収まる

### データモデル（`model.js` が正本）

```js
Trip {
  id, title, startDate, endDate,          // 日付は "YYYY-MM-DD"
  templateId, theme: { accent, font },    // A4の見た目
  mapStyle: "osm" | "positron",
  visits: Visit[],                        // order 昇順が時系列
  createdAt, updatedAt
}
Visit {
  id, order, date, name, lat, lng,
  comment,                                // 全角60字程度を想定（A4スロットに収まる長さ）
  photoIds: string[],
  transport: "walk"|"car"|"train"|"bus"|"plane"|"ship"|null   // 前地点からの移動手段（線のスタイルに反映）
}
Photo { id, blob, thumb /*dataURL*/, width, height, createdAt }

// JSON書き出し形式（写真は base64 に変換して1ファイルにまとめる）
Export { version: 1, exportedAt, trips: Trip[], photos: { [id]: { mime, base64, width, height } } }
```

---

## A4 テンプレート（Phase 2 で3種）

| ID | 名前 | 向き | 構成 |
|---|---|---|---|
| `map-hero` | 地図メイン | 縦 | 上2/3に地図＋ルート、下に写真3枚＋各ひとこと。タイトル・期間は左上 |
| `photo-grid` | フォト多め | 縦 | 上1/3に小さめ地図、下に写真6枚グリッド（各写真に地名キャプション） |
| `route-timeline` | 横長ルート | 横 | 左半分に地図、右半分に日付ごとの縦タイムライン（地名・コメント・小写真） |

テンプレは `templates.js` に **スロット定義**として持つ（`{ id, name, orientation, photoSlots, textSlots }`）。
A4 DOM はこの定義からテンプレ側の関数で組み立て、見た目は `print.css` の `.tpl-<id>` で切り替える。
この分離が Phase 4（自由配置）への足場になる：スロットの位置/サイズを「固定CSS」から「保存された座標」に置き換えるだけで済むようにしておく。

### 軽い調整（Phase 2 で対応）
- テンプレ切替、写真のスロット割当（クリックで入替）、写真の見せ位置（`object-position` を上下/左右にずらす）
- アクセント色 5 種、フォント 3 種（ゴシック / 明朝 / 手書き風。Google Fonts）
- タイトル・サブタイトルの編集、日付表示の有無、地図スタイル（標準/淡色）

### 印刷の実装方針
- 印刷専用ビュー `#/print/<tripId>`。`210mm × 297mm`（横は逆）の固定ボックスに描く。`@page { size: A4; margin: 0 }`
- 地図は印刷ビューでも Leaflet を生かしたまま置く（別インスタンス、`zoomControl:false`、操作無効）。
  **タイル読み込み完了（`tileLayer.on('load')`）を待ってから印刷ボタンを有効化**する。ここを省くと白抜けが出る
- Chrome 想定。「背景のグラフィック」チェックを促す注記を印刷ボタン脇に置く。iOS Safari は `@page` の横向き指定を無視するため、横長テンプレは PC の Chrome で印刷する
- Phase 3 で PNG 書き出し（html2canvas、`useCORS:true`。OSMタイルは CORS 許可済み）を追加し、Canva ルートを開く

---

## フェーズ計画とモデル分担

| Phase | 内容 | 担当モデル | 完了条件 |
|---|---|---|---|
| 0 | 設計（本書・CLAUDE.md・TASKS.md） | **Opus**（済） | ユーザー承認 |
| 1 | データ層＋編集画面＋地図 | Sonnet | 旅を作り、検索/クリックで5地点置き、線が引かれ、リロード後も残る。`tests.html` 全通過 |
| 2 | 印刷ビュー＋テンプレ3種＋軽い調整 | Sonnet | 3テンプレとも Chrome で A4 1枚に収まり PDF 保存できる |
| 3 | 磨き：写真クロップ、PNG書き出し、JSON入出力の使い勝手、GitHub Pages 公開 | Sonnet（低）。Haiku は文言修正程度に限定 | 公開URLで一通り動く。README に URL 追記 |
| 4 | 将来：自由配置編集、道なりルート、Canva連携、クラウド同期 | 都度判断 | — |

Opus は Phase 0 のみ。以降は `CLAUDE.md` の指示だけで他モデルが迷わず進める粒度で書いてある。

---

## 追加で決めたこと（2026-09-21、すべて推奨案で承認）

- サイト名「旅あと」、リポジトリ名 `tabi-ato`、公開URL は `https://mkt918.github.io/tabi-ato/`
- 移動手段は **線のスタイルだけ**に反映（実線＝車/バス、点線＝電車、破線＝徒歩、細い一点鎖線＝飛行機/船）。アイコンは Phase 4 で必要なら
- 1旅の地点数が A4 の目安（テンプレごとに 8〜12）を超えたら、**地図には全点を出し、一覧・写真スロットは先頭から目安数まで**。超過分は印刷ビューに「他 n 地点」と注記
- EXIF 回転は Phase 1 は `image-orientation: from-image` に任せ、崩れたら Phase 3 で補正

## 関連

- 置き場所ルール・命名：`00_作業/CLAUDE.md`、memory `project_placement_rule`
- 同方式の先行例：`public/13_wavelength`（tokens.css / tests.html / GitHub Pages）

---

## 設計（2026-09-21、CP1 承認）

### 画面（`index.html` 単一、ハッシュルーティング）
| ルート | 画面 | 内容 |
|---|---|---|
| `#/` | 旅一覧 | 作成・複製・削除、更新順 |
| `#/trip/<id>` | 編集 | 左：訪問地リスト（検索追加・地図クリック追加・編集・削除・並替・写真・コメント）／右：Leaflet 地図（番号ピン・移動手段別の線） |
| `#/print/<id>` | 印刷 | A4 `.sheet`、テンプレ3種、軽い調整、印刷ボタン（タイル load 待ち） |
| `#/settings` | 設定 | JSON 書き出し/読み込み、`countrycodes=jp` の切替 |

### 決定事項
- 構築はこの場（Opus）で行い、同型の反復（テンプレ 2・3 個目など）のみ sonnet サブエージェントへ委譲
- `要件定義.md` / `タスク.md` は新設せず README.md / TASKS.md を正本とする
- リポジトリは公開（`mkt918/tabi-ato`）。写真・データはブラウザ内のみでリポジトリに含まれない
- ES modules と Nominatim の Referer 要件のため `file://` では動かさない。ローカルは `python -m http.server`
- 並び替えは HTML5 ネイティブ D&D ＋ ▲▼ボタン。ライブラリ無し
- フォント3種：Noto Sans JP／Noto Serif JP／Zen Kurenaido（Google Fonts）
- アクセント5色：藍・朱・深緑・芥子・葡萄。tokens.css は「旅のしおり」方向（生成りの紙＋青緑 1 色）
- 移動手段は線のスタイルのみ。未指定は実線
- Phase 3 の PNG 書き出しは html2canvas が必要。着手時に改めて確認
- 旅の削除時は紐づく写真も削除
- IndexedDB は DB 名 `tabi-ato`、ストア `trips`・`photos`
