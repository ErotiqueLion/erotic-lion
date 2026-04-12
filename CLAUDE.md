# ErotiqueLion プロジェクト — CLAUDE.md

## プロジェクト概要

大人向けアダルトゲームサイト。**昔のサーカスの出し物**のような怪しく退廃的な世界観をベースに、エロスとジョークを融合させた体験を提供する。プレイヤーがドキドキ・ワクワクするコンテンツを優先。動画・画像・音声はできる限りリアルに。マネタイズは今後の課題。

---

## 世界観・トーン指針

- **雰囲気**: 古いサーカスの見世物小屋。薄暗く、怪しく、少し笑える
- **エロス**: 直球ではなく、煽り・じらし・ユーモアを組み合わせる
- **テキスト**: 品はないが品格はある。下品になりすぎず、ジョークを忘れない
- **メディア**: 素材はリアル志向（アニメ調より実写・フォトリアル）

---

## 統一デザインシステム

全ゲーム・ポータルで以下を共通で使用すること。ゲームごとに独自スタイルを作らない。

### カラーパレット

| 用途 | カラーコード | 説明 |
|---|---|---|
| 背景 | `#0d0008` | ほぼ黒の深紫 |
| メインカラー | `#8b0000` | 深紅 |
| アクセント | `#c9a84c` | 燻し金 |
| テキスト | `#f0e6d3` | 古い羊皮紙色 |
| サブテキスト | `#9e8f7a` | 褪せた羊皮紙色 |
| 区切り・枠線 | `#3a1a1a` | 暗い深紅 |

### フォント

- **見出し・タイトル**: `Cinzel`（Google Fonts）— ラテン文字の格調
- **日本語見出し**: `Noto Serif JP`（Google Fonts）— 和文セリフ
- **本文・UI**: `Noto Serif JP` または `Georgia`
- 游ゴシック・ヒラギノ等のサンセリフ系は使わない

```html
<!-- Google Fonts 読み込みテンプレート -->
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Noto+Serif+JP:wght@400;700&display=swap" rel="stylesheet">
```

### ポータルのゲームカード UI

各ゲームの入口は「見世物小屋の幕」スタイルで統一する：

- カード背景に深紅のカーテン or 木製テクスチャ
- タイトルは金色（`#c9a84c`）の Cinzel フォント
- ホバーで幕が揺れるか、蝋燭が揺れるようなアニメーション
- クリックで「幕が開く」トランジション（フェードまたはスライド）

### UIコンポーネント共通ルール

- **ボタン**: 深紅の枠線 + 燻し金テキスト。ホバーで金色グロー
- **背景**: ベタ塗りより薄いテクスチャ（ノイズ・木目・布地）を優先
- **装飾**: 細い金色ラインで区切る。過剰な装飾は避ける
- **エフェクト**: 蝋燭のチラつき、煙、赤いグロー — 控えめに使う

### 音・演出の方向性

- BGMは低音の弦楽器・オルゴール・環境音ベース（明るいポップは禁止）
- SE（効果音）はアナログ・ヴィンテージ寄り（8bit禁止）
- 声・TTS は色気・落ち着き優先。アニメ声は使わない

---

## フォルダ構成

```
C:\ErotiqueLion\
  ├── CLAUDE.md              ← このファイル
  ├── 再開指示書.md
  ├── 要件.txt
  ├── EroticWordChain\       ← EroticWordChain ゲーム（Vite + React）
  ├── Hip\
  │   └── hip.html           ← HIP ゲーム（単体HTML）
  ├── Inmouder\
  │   └── Inmouder.html      ← 陰毛だーゲーム（単体HTML）
  └── Secret\                ← ⚠️ 機密情報専用（絶対にgit pushしない）
```

---

## リポジトリ・デプロイ情報

| 項目 | 内容 |
|---|---|
| 開発リポジトリ（Private） | `https://github.com/ErotiqueLion/erotic-lion-dev` |
| 配信リポジトリ（Public） | `https://github.com/ErotiqueLion/erotic-lion` |
| 公開 URL（ポータル） | `https://erotiquelion.github.io/erotic-lion/` |
| 公開 URL（EroticWordChain） | `https://erotiquelion.github.io/erotic-lion/games/erotic-word-chain/` |
| デプロイ方式 | GitHub Actions → gh-pages ブランチ自動デプロイ |
| ブランチ | main（ソース） / gh-pages（配信） |

デプロイは `git push` するだけで自動実行（約1〜2分）。

---

## ゲーム一覧

### EroticWordChain
- **場所**: `EroticWordChain/`
- **技術**: Vite + React 19、Gemini 2.5 Flash（AI対話・TTS）、GCP Cloud TTS Neural2
- **内容**: AIキャラクターとのエロしりとりゲーム
- **状態**: 実装完了・公開中

### HIP
- **場所**: `Hip/hip.html`
- **技術**: 単体HTML
- **状態**: 公開中

### 陰毛だーゲーム
- **場所**: `Inmouder/Inmouder.html`
- **技術**: 単体HTML
- **状態**: 公開中

### Psycho Loop
- **状態**: 未実装（404）

---

## 開発ルール

### ⚠️ セキュリティ
- **`Secret/` フォルダは絶対に git push しない**（`.gitignore` 設定済み）
- APIキーは `key.txt` や `.env` に書かず、ユーザーが設定画面から入力（localStorage 保存）
- `key.txt` / `*.key` / `.env` は `.gitignore` 済み

### コーディング規約
- コードの注釈・コメントは**日本語**で記述する
- 不要なファイルを増やさない（旧バージョンファイルは整理する）
- ローカル確認は `npm run dev`、本番確認は GitHub Pages で行う

### EroticWordChain 固有
- `vite.config.js` の `base` は `/erotic-lion/games/erotic-word-chain/` のまま変更しない
- しりとりバリデーションは3重チェック（クライアント → Gemini → 二次検証）

---

## 開発コマンド（EroticWordChain）

```bash
cd C:\ErotiqueLion\EroticWordChain
npm run dev    # ローカル起動（localhost:5173）
npm run build  # 本番ビルド確認
```

---

## 課題・TODO

1. **kuroshiro 導入**: 漢字末尾のしりとり判定をクライアント側に移行（別ブランチで実装）
2. **履歴表示UI**: 使った単語一覧パネル
3. **設定通知テスト**: トーストの見た目を確認するボタン
4. **Psycho Loop**: 新ゲームの実装
5. **マネタイズ**: 今後の課題
