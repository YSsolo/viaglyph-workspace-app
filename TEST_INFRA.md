# E2E Test Infra: ViaGlyph Workspace App

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Framework: Playwright (`@playwright/test`) with local HTTP server (`serve` or static host) + Node stress harnesses.
- Multi-context testing: 2 browser contexts (User A: 山口 慧, User B: 市川 翔大) verifying RTDB real-time synchronization within 3 seconds without page refresh.
- Adversarial hardening: High-frequency concurrent multi-session writes to all 6 RTDB nodes and rapid UI state toggles under race conditions.

## Feature Inventory & Tiered Coverage Plan

| Feature | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Cross-Feature) | Tier 4 (Real-World Multi-Client) | Tier 5 (Adversarial Hardening) |
|---------|:----------------:|:-----------------:|:---------------------:|:--------------------------------:|:------------------------------:|
| 1. Login & Auth | 5 test cases | 5 test cases | Session persistence | Multi-tab auth state | Rate-limiting & lock resilience |
| 2. Record Form | 5 test cases | 5 test cases | WorkLog submission -> Timeline | Real-time WorkLog timeline sync | Concurrent WorkLogs push/set burst |
| 3. Kanban Tab | 5 test cases | 5 test cases | Done drop -> WorkLog | 3.0s multi-tab card status sync | Rapid status shifts & D&D drops |
| 4. Goals Tab | 5 test cases | 5 test cases | Goal toggle -> progress | Multi-tab goal status sync | Concurrent goal tree edits |
| 5. Members Tab | 5 test cases | 5 test cases | Status -> Member list | 3.0s status dot & label sync | 50 rapid toggles (<3s convergence) |
| 6. Canvas Tab | 5 test cases | 5 test cases | Block sync | 3.0s real-time canvas sync | Dual-context concurrent block edits |

## Test Architecture
- Test Runner: `@playwright/test` & Node.js
- Web Server Command: `npm run start` (or `npx serve . -p 3000`)
- Execution Commands:
  - `npm run test:e2e`: Runs all 71 Playwright spec tests (`tests/*.spec.js`)
  - `npm run test:stress`: Runs Tier 5 empirical stress harness (`tests/tier5-stress-harness.js`)
- Configuration file: `playwright.config.js`
- Test Files Directory: `tests/`
  - `tests/tier1-features.spec.js`: Login, Record, Kanban, Goals, Members, Canvas tab feature tests.
  - `tests/tier2-boundary.spec.js`: Input validation, boundary values, extreme strings, invalid credentials.
  - `tests/tier3-crossfeature.spec.js`: Kanban Done drop triggering automatic WorkLog creation and timeline update.
  - `tests/tier4-multiclientsync.spec.js`: Multi-browser context real-time state synchronization within 3.0 seconds.
  - `tests/tier5-concurrent-writes.spec.js`: Multi-browser Playwright tests for concurrent multi-session writes & rapid toggles.
  - `tests/tier5-stress-harness.js`: Empirical Node test harness for 100 concurrent RTDB ops & rapid UI state race condition checks.

## Coverage Goals & Thresholds
- Tier 1: ≥30 test cases covering 6 feature areas.
- Tier 2: ≥30 test cases covering boundary values & error conditions.
- Tier 3: Cross-feature interaction (Kanban to WorkLog, Member status to team view).
- Tier 4: Multi-context real-time sync across 2 browser contexts within 3.0s timeout limit.
- Tier 5: Multi-session concurrent writes across 6 RTDB nodes & 50 rapid UI state toggles without deadlock, UI corruption, or memory leaks; eventual consistency < 3.0s.
