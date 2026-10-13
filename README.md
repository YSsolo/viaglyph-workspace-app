# ViaGLYPH Workspace App

ViaGLYPH Workspace App は、3名チーム向けのプロジェクト運転盤です。会議で決めたことを `Project → Milestone → Task` の単一モデルへ登録し、担当・期限・ブロッカー・GitHub Issueをまとめて追跡します。

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
│  - /pm/projects             │   │  - createSlackCanvas        │
│  - /pm/milestones           │   │  - GitHub同期 / Webhook     │
│  - /pm/tasks                │   └──────────────┬──────────────┘
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
├── index.html            # Dashboard / Projects / Tasks / Meetings / Work Log
├── api.js                # Firebase Singleton & RTDB/Functions API層
├── store.js              # クライアントデータストア & イベント処理
├── views.js              # DOM描画 & ビューイベントハンドラー
├── canvas.js             # リアルタイム会議キャンバス
├── style.css             # アプリケーション共通スタイル
├── canvas.css            # キャンバス専用スタイル
├── pm.js / pm.css        # PM v2のデータ操作・運転盤UI
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

## 👥 認証とGitHub連携

- ログインはFirebase AuthenticationのGitHub Providerを使います。許可するGitHub numeric IDはCloud Functionの `GITHUB_MEMBERS` に限定します。
- GitHub API用Fine-grained PATはownerごとにFirebase Secret Managerへ登録します。`GITHUB_TOKEN_GANDT`、`GITHUB_TOKEN_YSSOLO`、`GITHUB_TOKEN_SHOTA656` を使います。
- Webhookは `GITHUB_WEBHOOK_SECRET` で `X-Hub-Signature-256` を検証します。ブラウザ・Realtime Database・Issue本文にPATやWebhook Secretを置かないでください。
- Slack日次通知は `pm/settings/slackChannel` に保存したチャンネルへ、平日9:00 JSTに送信します。

---

## 🔐 セキュリティ & デプロイ

- **Firebase Realtime Database Rules**: `database.rules.json` により、GitHub OAuth後に付与される `workspaceMember` claimを必須にします。
- **Slack / Discord プロキシ**: `functions/index.js` により、Bot Token をサーバーサイドで保護し、CORS エラーを回避して外部通知を投稿。
- **PM同期**: TaskはIssue、MilestoneはGitHub Milestoneへ同期します。GitHub障害時はTaskを保存し、`pending/error` 状態から15分ごとに再試行します。
- **正式入口**: チーム利用は Firebase Hosting URL を使用します。`localhost` は開発専用です。
- **リリース**: GitHub Actions の `Firebase release` だけが Functions、Rules、Hosting を配布します。必要なOIDC・Secretsの初期設定は [release runbook](docs/release-runbook.md) を参照してください。
