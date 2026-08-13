# Project: ViaGlyph Workspace App Firebase Migration

## Architecture
- **Frontend**: Pure HTML/CSS/JS (`index.html`, `api.js`, `store.js`, `views.js`, `canvas.js`, `style.css`, `canvas.css`). Hosted on Vercel.
- **Backend (Target)**: Firebase Realtime Database (`viaglyph-workspace-default-rtdb.firebaseio.com`) + Firebase Cloud Functions (`functions/index.js`).
- **Data Access Layer**: Consolidated global Firebase singleton initialized in `api.js`. `canvas.js` reuses global `window.firebaseDb`. All GAS `fetch` calls replaced with Firebase RTDB `.on()`, `.set()`, `.push()`, `.update()`.
- **Serverless Proxy**: Cloud Functions (`sendSlackMessage`, `createSlackCanvas`) providing CORS-enabled HTTP endpoints with protected Slack Bot credentials.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Global Firebase Init | Consolidate `FIREBASE_CONFIG` & `firebase.initializeApp()` into a single global initialization. | M1 | survey |
| 2 | RTDB Data Access Layer | Replace 14 GAS endpoints in `api.js` with direct Firebase RTDB CRUD operations. | M2 | survey |
| 3 | Realtime Synchronization | Implement `.on('value')` listeners for Tasks, WorkLogs, Goals, MemberStatus, DailyMemos. | M2 | survey |
| 4 | Cloud Functions Slack Proxy | Re-implement `sendSlackMessage` & `createSlackCanvas` in Cloud Functions with CORS support. | M3 | survey |
| 5 | Data Migration Script | Create standalone Node script `scripts/migrate-data.js` to import Spreadsheet/seed data into RTDB. | M4 | survey |
| 6 | Security Rules & README | Enforce structural schema validation in `database.rules.json` and update `README.md`. | M5 | survey |
| 7 | Dual-Track E2E Test Suite | Build Playwright multi-context E2E test suite verifying 3s sync across open tabs & acceptance criteria. | E2E-Track | survey |

## Code Layout
- `index.html`: Web App entry, CDN scripts, layout modals
- `api.js`: Firebase DB global initialization, RTDB CRUD functions, Cloud Functions proxy client calls
- `store.js`: Local state store, initial seeds, event dispatching
- `views.js`: View rendering, DOM event handlers, Kanban drag-and-drop actions
- `canvas.js`: Conference canvas editor, reusing `window.firebaseDb`
- `database.rules.json`: RTDB security rules
- `functions/index.js`: Cloud Functions for Slack/Discord HTTP endpoints
- `scripts/migrate-data.js`: Spreadsheet -> RTDB migration tool
- `tests/realtime-sync.spec.js`: Playwright E2E test suite

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Global Firebase Initialization | Consolidate config, single initializeApp in `api.js`, update `index.html` & `canvas.js`. | None | DONE |
| M2 | RTDB Data Access & Realtime Sync | Replace GAS calls in `api.js`, wire RTDB `.on('value')` to `store.js`/`views.js`. | M1 | DONE |
| M3 | Cloud Functions Slack/Discord Proxy | Implement `functions/index.js`, `firebase.json` update, wire `api.js` proxy calls. | M1 | DONE |
| M4 | Spreadsheet Data Migration Script | Implement `scripts/migrate-data.js` with Spreadsheet/seed fallback parser. | M1, M2 | DONE |
| M5 | Security Rules & Documentation | Update `database.rules.json` & `README.md`. | M2, M3, M4 | DONE |
| M_FINAL | Pass 100% E2E Tests & Audit | Verify all acceptance criteria, multi-tab 3s sync, pass forensic audit. | M1-M5, E2E | DONE |
| M_REMEDIATE | Fix 9 Failing E2E Tests & Re-Audit | Fix 9 failing edge-case E2E tests in `views.js`, `api.js`, `store.js`, and re-verify Playwright suite 100%. | M_FINAL | DONE |

## Interface Contracts

### Global Firebase Instance Contract (`window.firebaseDb`)
- Exposed by: `api.js`
- Used by: `api.js`, `store.js`, `canvas.js`
- Interface:
  ```javascript
  window.FIREBASE_CONFIG = { ... };
  window.firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
  window.firebaseDb = firebase.database();
  ```

### Realtime Database Schema Contract
- `/tasks/dev` & `/tasks/biz`: `{ [id]: { id, title, status, prio, assign, due, tags[], ctx, created_at } }`
- `/workLogs`: `{ [id]: { id, taskId, date, minutes, tags[], comment, user, createdAt } }`
- `/goals`: `{ projects: [ { id, name, icon, status, assignees[], due, bigGoals: [...] } ] }`
- `/memberStatus`: `{ [userShortKey]: 'online'|'away'|'offline' }`
- `/dailyMemos`: `{ [date_YYYY_MM_DD]: string }`
- `/users`: `{ [userEmailKey]: { email, name, short, role, emoji, bg, passwordHash } }`
- `/canvases`: Existing canvas blocks & presence data

### Cloud Functions HTTP Endpoints Contract
- `sendSlackMessage`: POST `https://<region>-<project>.cloudfunctions.net/sendSlackMessage`
  - Body: `{ channel: string, messagePayload: object, webhookUrl?: string }`
  - Response: `{ success: boolean, response?: object, error?: string }`
- `createSlackCanvas`: POST `https://<region>-<project>.cloudfunctions.net/createSlackCanvas`
  - Body: `{ channel: string, title: string, markdown: string }`
  - Response: `{ success: boolean, canvas_id?: string, error?: string }`
