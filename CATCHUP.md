# ViaGLYPH Workspace — 開発キャッチアップ

> 最終更新: 2026-05-05
> このファイルはWorkspaceプロトタイプの全体像を把握するためのエントリーポイントです。

## 📁 ファイル構成

```
prototypes/workspace/
├── index.html      ← メインHTML（全ビュー・ナビ・設定画面）
├── style.css       ← ベーススタイル（レイアウト・ナビ・フォーム・カード）
├── canvas.css      ← キャンバス専用スタイル（テーブル・コールアウト・メンション）
├── canvas.js       ← キャンバスロジック（Firebase同期・ブロックエディタ）
├── views.js        ← ビュー切り替え・看板・目標・日報・設定保存/読込
├── store.js        ← ローカルストレージ管理
├── api.js          ← GAS API連携（認証・データ同期）
├── ideas-mockup.html ← 新機能アイデアモック（5案）
├── gas/            ← Google Apps Script（バックエンド）
├── gas-deploy/     ← GASデプロイ用
└── CATCHUP.md      ← このファイル
```

## 🏗 アーキテクチャ

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  index.html  │     │   GAS API    │     │   Firebase   │
│  + views.js  │◄───►│  (認証/CRUD) │     │  Realtime DB │
│  + store.js  │     └──────────────┘     └──────┬───────┘
│  + api.js    │                                 │
│  + canvas.js │◄────────────────────────────────┘
└──────────────┘         リアルタイム同期
```

### データソース
| データ | ソース | 同期方式 |
|---|---|---|
| メンバー・タスク・日報 | Google スプレッドシート via GAS | api.js → 手動/30秒ポーリング |
| キャンバス（ドキュメント） | Firebase Realtime DB | canvas.js → リアルタイム |
| 設定（Slack Webhook等） | localStorage | views.js → 即時保存 |

## 🔐 Firebase設定

```javascript
// canvas.js 内で定義
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDS4v9y0FnUvY5MFxtypkWrrSAH8GMUCLY",
  databaseURL: "https://viaglyph-workspace-default-rtdb.firebaseio.com",
  projectId: "viaglyph-workspace",
  appId: "1:1062801720102:web:9b99141f1a21b4e76937e7"
};
```

- **セキュリティルール**: テストモード（2026-06-04 まで全公開）
- **データ構造**: `/canvases/{id}/blocks/{blockId}` + `/presence/{canvasId}/{user}`

## 📱 ナビゲーション構成

```
👥メンバー → 🗂看板 → ✏️記録(中央CTA) → 📄キャンバス → 🎯目標
```

`views.js` の `setView(name)` で切り替え。各ビューは `#view-{name}` セクション。

### ビュー一覧
| ビュー | ID | 主な機能 |
|---|---|---|
| メンバー | `view-members` | チーム稼働状況・取組中タスク表示 |
| 看板 | `view-kanban` | タスクのカンバンボード（日報含む） |
| 記録 | `view-record` | ストップウォッチ＋作業記録 |
| キャンバス | `view-canvas` | リアルタイム共同編集ドキュメント |
| 目標 | `view-goals` | プロジェクト→大目標→中目標→タスクのツリー |
| 設定 | `view-settings` | Slack/Discord連携・通知・アプリ設定 |

## 📄 キャンバス機能

### ブロックタイプ
| タイプ | ショートカット | 説明 |
|---|---|---|
| `text` | （デフォルト） | 通常テキスト |
| `heading` | `# ` + Space | 見出し（H1） |
| `subheading` | `## ` + Space | 小見出し（H2） |
| `checkbox` | `[] ` + Space | チェックリスト |
| `quote` | `> ` + Space | 引用 |
| `divider` | `---` + Space | 区切り線 |
| `table` | ツールバーの ⊞ | 編集可能テーブル（行/列追加可能） |
| `callout-*` | ツールバーの 💙💚💛❤️ | 色付きコールアウト（blue/green/yellow/red） |

### フォーマットツールバー
`B` 太字 / `I` 斜体 / `S` 取消線 / H1 H2 / ☑ ❝ ― / ⊞ テーブル / 💙💚💛❤️ 色 / @ メンション

### メンション
- `@名前` と入力するとハイライト表示
- ツールバーの `@` ボタンでメンバーポップアップ表示

### IME対応
`compositionstart` / `compositionend` で日本語変換中のレンダリング・保存を抑制。

## ⚙️ 設定画面

### Slack連携
- **Webhook方式**: URLを入力して通知送信（簡単）
- **Bot Token方式**: `xoxb-` トークンで高機能連携（`chat:write`, `users:read`, `channels:read`）
- **通知イベント**: スタンドアップ / タスク完了 / 日報 / キャンバス更新
- **メッセージ設定**: Block Kit / リンク / @channel
- **定期投稿**: 毎朝サマリー / 週次レポート

### Discord連携
- Webhook URLでの通知送信

### アプリ設定
- 自動同期（30秒）/ 通知サウンド

## 🔑 認証

GAS経由のメールアドレスログイン（`api.js`）。3メンバー登録済み：
- `murayama@mtl.t.u-tokyo.ac.jp`（村山）
- `shotaatut@gmail.com`（市川）
- `siteiiryoubugaihinn2@gmail.com`（山口）

## 🚀 開発サーバー起動

```bash
cd prototypes/workspace
python -m http.server 9910
# → http://127.0.0.1:9910/index.html
```

## ⚠️ 注意事項

1. **Firebase テストモード期限**: 2026-06-04。本番運用時は認証ルール必須
2. **GASとFirebase認証は未統合**: 将来SSO連携が必要
3. **canvas.js の FIREBASE_CONFIG はハードコード**: デプロイ時は環境変数推奨
4. **Vercelデプロイ済み**: 本番URLは Vercel ダッシュボードで確認

## 📋 次のステップ候補

1. **非同期スタンドアップ** — 毎朝3問回答（`ideas-mockup.html` の①参照）
2. **ムードトラッカー** — チーム健康度可視化
3. **KPT振り返り** — Firebase活用でリアルタイム共有
4. **Firebase Auth統合** — GASログインとの連携
