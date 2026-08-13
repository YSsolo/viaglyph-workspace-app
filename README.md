# ViaGLYPH Workspace App

ViaGLYPH Workspace App は、チーム（3名固定）向けの日報入力・作業ログ記録・Kanbanタスク管理・目標ツリー管理・会議キャンバス機能を備えたリアルタイムWebアプリケーションです。

バックエンドは Firebase Realtime Database および Firebase Cloud Functions (v2) を基盤としており、複数ブラウザ間での即時リアルタイム同期とSlack/Discord通知プロキシ連携を実現しています。

---

## 🏗️ アーキテクチャ構成

```
┌────────────────────────────────────────────────────────┐
│             フロントエンド (HTML / CSS / JS)           │
│        Vercel デプロイ / ローカル dev server (3000)    │
└──────────────┬─────────────────────────┬───────────────┘
               │                         │
      RTDB SDK │ Listener / CRUD         │ HTTP POST (CORS)
               ▼                         ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ Firebase Realtime Database  │   │   Firebase Cloud Functions  │
│ (viaglyph-workspace-default)│   │  - sendSlackMessage         │
│  - /users                   │   │  - createSlackCanvas        │
│  - /tasks/dev & /biz        │   └──────────────┬──────────────┘
│  - /workLogs                │                  │
│  - /goals                   │                  ▼
│  - /memberStatus            │         Slack API / Discord
│  - /dailyMemos              │         Webhook Direct POST
│  - /canvases                │
└─────────────────────────────┘
```

---

## 📁 ディレクトリ構成

```
viaGlyph_workspace_app/
├── index.html            # メインUI（5タブ構成・モーダル）
├── api.js                # Firebase Singleton & RTDB/Functions API層
├── store.js              # クライアントデータストア & イベント処理
├── views.js              # DOM描画 & ビューイベントハンドラー
├── canvas.js             # リアルタイム会議キャンバス
├── style.css             # アプリケーション共通スタイル
├── canvas.css            # キャンバス専用スタイル
├── database.rules.json   # RTDB セキュリティルール (Schema Validation)
├── firebase.json         # Firebase プロジェクト設定
├── package.json          # npm スクリプト & 依存関係
├── functions/            # Firebase Cloud Functions バックエンド
│   ├── index.js          # Slack / Discord 通知プロキシ関数
│   └── package.json      # Functions 依存関係
├── scripts/              # データ移行ユーティリティ
│   └── migrate-data.js   # Spreadsheet/Seed -> RTDB 移行スクリプト
└── tests/                # Playwright E2E テストスイート
    ├── tier1-features.spec.js
    ├── tier2-boundary.spec.js
    ├── tier3-crossfeature.spec.js
    └── tier4-multiclientsync.spec.js
```

---

## 🚀 クイックスタート & 開発手順

### 1. 前提条件
- Node.js v18 以上
- npm v9 以上

### 2. バックエンド Cloud Functions のセットアップ
`functions` ディレクトリ配下の依存パッケージをインストールします。

```bash
cd functions
npm install
cd ..
```

### 3. ローカル開発サーバーの起動
ローカルWebサーバーを起動して http://localhost:3000 にアクセスします。

```bash
npm start
```

### 4. 既存データの移行 (Data Migration)
Google Spreadsheet またはローカルシードデータから Firebase Realtime Database へデータを一括送信・初期化します。

```bash
npm run migrate
```
*(または `node scripts/migrate-data.js`)*

### 5. E2E テストの実行 (Playwright)
マルチコンテキストによる 3 秒以内のリアルタイム同期検証を含む E2E テストを実行します。

```bash
npm run test:e2e
```

---

## 👥 チームメンバー (固定3名)

| メール | 名前 | 略称 | 役割 | パスワード |
|--------|------|------|------|-----------|
| `shotaatut@gmail.com` | 市川 翔大 | 市川 | CEO / ビジネス | `viaglyph2026` |
| `murayama@mtl.t.u-tokyo.ac.jp` | 村山 貴志 | 村山 | テックリード | `viaglyph2026` |
| `siteiiryoubugaihinn2@gmail.com` | 山口 慧 | 山口 | エンジニア | `viaglyph2026` |

---

## 🔐 セキュリティ & デプロイ

- **Firebase Realtime Database Rules**: `database.rules.json` により、パス別の型検証・必須フィールド検証・ステータス文字列検証を適用済み。
- **Slack / Discord プロキシ**: `functions/index.js` により、Bot Token をサーバーサイドで保護し、CORS エラーを回避して外部通知を投稿。
