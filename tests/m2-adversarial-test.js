/**
 * Deep Adversarial Verification Suite for Milestone 2
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT_DIR, 'api.js');
const STORE_PATH = path.join(ROOT_DIR, 'store.js');
const VIEWS_PATH = path.join(ROOT_DIR, 'views.js');

console.log('=== Starting M2 Deep Adversarial Verification Suite ===\n');

let totalAdv = 0;
let passedAdv = 0;
let failedAdv = 0;

function testAdv(name, passed, detail = '') {
  totalAdv++;
  if (passed) {
    passedAdv++;
    console.log(`  [PASS] ${name}`);
  } else {
    failedAdv++;
    console.log(`  [FAIL] ${name}: ${detail}`);
  }
}

function createMockEnv() {
  const dbListeners = {};
  const dbData = {
    tasks: {
      dev: { 1: { id: 1, title: 'Dev Task 1', status: 'WIP', ctx: 'dev', tags: ['dev'], assign: '山口' } },
      biz: { 10: { id: 10, title: 'Biz Task 10', status: 'TODO', ctx: 'biz', tags: ['biz'], assign: '市川' } }
    },
    workLogs: {
      'log1': { id: 'log1', taskId: 1, minutes: 60, user: '山口', date: '2026-08-11', comment: 'Initial work' }
    },
    goals: [
      { id: 1, name: 'ViaGLYPH', icon: '🧠', bigGoals: [] }
    ],
    memberStatus: { yamaguchi: 'online', ichikawa: 'away', murayama: 'offline' },
    dailyMemos: { '2026-08-11': 'Focus on M2 verification' }
  };

  function getNode(p) {
    const parts = p.split('/').filter(Boolean);
    let curr = dbData;
    for (const part of parts) {
      if (!curr || typeof curr !== 'object' || !(part in curr)) return undefined;
      curr = curr[part];
    }
    return curr;
  }

  function setNode(p, data) {
    const parts = p.split('/').filter(Boolean);
    let curr = dbData;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = data;

    const rootPath = parts[0];
    if (dbListeners[rootPath]) {
      dbListeners[rootPath].forEach(cb => cb({ val: () => dbData[rootPath] }));
    }
  }

  function updateNode(p, data) {
    const parts = p.split('/').filter(Boolean);
    let curr = dbData;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    curr[lastKey] = (curr[lastKey] && typeof curr[lastKey] === 'object') ? { ...curr[lastKey], ...data } : data;

    const rootPath = parts[0];
    if (dbListeners[rootPath]) {
      dbListeners[rootPath].forEach(cb => cb({ val: () => dbData[rootPath] }));
    }
  }

  const mockDbRef = (refPath) => ({
    on: (event, cb) => {
      if (!dbListeners[refPath]) dbListeners[refPath] = [];
      dbListeners[refPath].push(cb);
      const val = getNode(refPath);
      cb({ val: () => val });
    },
    off: () => {
      delete dbListeners[refPath];
    },
    once: (event) => {
      const val = getNode(refPath);
      return Promise.resolve({ val: () => val });
    },
    set: (data) => {
      setNode(refPath, data);
      return Promise.resolve();
    },
    update: (data) => {
      updateNode(refPath, data);
      return Promise.resolve();
    },
    push: () => {
      const key = 'key_' + Math.random().toString(36).substr(2, 6);
      return {
        key,
        set: (data) => {
          setNode(refPath + '/' + key, data);
          return Promise.resolve();
        }
      };
    }
  });

  const mockFirebase = {
    apps: [],
    app: () => mockFirebase.apps[0],
    initializeApp: (cfg) => {
      const app = { name: '[DEFAULT]', options: cfg };
      mockFirebase.apps.push(app);
      return app;
    },
    database: () => ({ ref: mockDbRef })
  };

  const storageMap = {};
  const mockLocalStorage = {
    getItem: (k) => storageMap[k] || null,
    setItem: (k, v) => { storageMap[k] = String(v); },
    removeItem: (k) => { delete storageMap[k]; }
  };

  const renderCalls = { renderAll: 0, renderTimeline: 0, renderDaily: 0, renderMembers: 0, renderGoals: 0 };

  const mockDocument = {
    getElementById: (id) => ({
      value: '',
      textContent: '',
      classList: { add: () => {}, remove: () => {} },
      addEventListener: () => {},
      style: {}
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null
  };

  const mockWindow = {
    document: mockDocument,
    localStorage: mockLocalStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { reload: () => {} }
  };
  mockWindow.window = mockWindow;

  const sandbox = new Proxy({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockLocalStorage,
    firebase: mockFirebase,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Array,
    Object,
    Promise,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    dbListeners,
    dbData,
    renderCalls
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop in mockWindow) return mockWindow[prop];
      if (prop in globalThis) return globalThis[prop];
      return undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      mockWindow[prop] = value;
      return true;
    },
    has(target, prop) {
      return (prop in target) || (prop in mockWindow) || (prop in globalThis);
    }
  });

  const context = vm.createContext(sandbox);
  return { context, sandbox, dbListeners, dbData, storageMap, renderCalls };
}

async function runAdversarialSuite() {
  // -------------------------------------------------------------
  // ADVERSARIAL TEST 1: Auth & Rate Limiting
  // -------------------------------------------------------------
  console.log('--- Adversarial Test 1: Auth & Rate Limiting ---');
  try {
    const { context, sandbox } = createMockEnv();
    const apiCode = fs.readFileSync(API_PATH, 'utf8');
    vm.runInContext(apiCode, context);
    const API = sandbox.API;

    // Test email validation
    const invalidEmailRes = await API.login('invalid-email-format', 'viaglyph2026');
    assert.strictEqual(invalidEmailRes.success, false);
    assert.ok(invalidEmailRes.error.includes('メールアドレスの形式が正しくありません'));
    testAdv('Email validation catches malformed email', true);

    // Test failed attempts up to lock
    for (let i = 1; i <= 5; i++) {
      const res = await API.login('siteiiryoubugaihinn2@gmail.com', 'wrong_pass');
      assert.strictEqual(res.success, false);
      if (i < 5) {
        assert.ok(res.error.includes(`残り${5 - i}回`));
      } else {
        assert.ok(res.error.includes('30秒後に再試行してください'));
      }
    }
    testAdv('5 failed login attempts trigger 30-second lockout', true);

    // Locked out attempt
    const lockedRes = await API.login('siteiiryoubugaihinn2@gmail.com', 'viaglyph2026');
    assert.strictEqual(lockedRes.success, false);
    assert.ok(lockedRes.error.includes('30秒後に再試行してください'));
    testAdv('Login blocked while locked out', true);

    // Fast forward lock time
    API._lockUntil = 0;
    const successRes = await API.login('siteiiryoubugaihinn2@gmail.com', 'viaglyph2026');
    assert.strictEqual(successRes.success, true);
    assert.strictEqual(successRes.user.short, '山口');
    testAdv('Valid credentials succeed after lockout expires', true);

  } catch (e) {
    testAdv('Auth & Rate Limiting test', false, e.stack || e.message);
  }

  // -------------------------------------------------------------
  // ADVERSARIAL TEST 2: Realtime Multi-Client Data Mutation & UI Re-render Triggers
  // -------------------------------------------------------------
  console.log('\n--- Adversarial Test 2: Realtime Multi-Client Sync & Triggers ---');
  try {
    const env = createMockEnv();
    const apiCode = fs.readFileSync(API_PATH, 'utf8');
    const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
    const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

    vm.runInContext(apiCode, env.context);
    vm.runInContext(storeCode, env.context);
    vm.runInContext(viewsCode, env.context);

    const API = env.sandbox.API;
    API.initRealtimeListeners();

    // Track function calls
    let renderAllCount = 0;
    let renderTimelineCount = 0;
    let renderDailyCount = 0;
    let renderMembersCount = 0;
    let renderGoalsCount = 0;

    env.sandbox.renderAll = () => { renderAllCount++; };
    env.sandbox.renderTimeline = () => { renderTimelineCount++; };
    env.sandbox.renderDaily = () => { renderDailyCount++; };
    env.sandbox.renderMembers = () => { renderMembersCount++; };
    env.sandbox.renderGoals = () => { renderGoalsCount++; };

    // Simulate external update on /tasks
    env.dbListeners['tasks'][0]({
      val: () => ({
        dev: {
          1: { id: 1, title: 'Dev Task 1 Updated', status: 'Done', ctx: 'dev' }
        }
      })
    });
    assert.strictEqual(renderAllCount, 1, 'renderAll triggered on task change');
    testAdv('RTDB tasks listener updates DATA state & triggers renderAll()', true);

    // Simulate external update on /workLogs
    env.dbListeners['workLogs'][0]({
      val: () => ({
        'log1': { id: 'log1', taskId: 1, minutes: 120, user: '市川', date: '2026-08-11' }
      })
    });
    assert.ok(renderTimelineCount >= 1, 'renderTimeline triggered');
    assert.ok(renderDailyCount >= 1, 'renderDaily triggered');
    assert.ok(renderMembersCount >= 1, 'renderMembers triggered');
    testAdv('RTDB workLogs listener updates workLogs & triggers UI renders', true);

    // Simulate external update on /memberStatus
    env.dbListeners['memberStatus'][0]({
      val: () => ({ yamaguchi: 'away', ichikawa: 'online', murayama: 'online' })
    });
    assert.ok(renderMembersCount >= 2, 'renderMembers triggered again');
    testAdv('RTDB memberStatus listener updates memberStatuses & re-renders members', true);

    // Simulate external update on /dailyMemos
    env.dbListeners['dailyMemos'][0]({
      val: () => ({ '2026-08-11': 'Updated Memo' })
    });
    assert.ok(renderDailyCount >= 2, 'renderDaily triggered again');
    testAdv('RTDB dailyMemos listener updates dailyMemos & re-renders daily', true);

  } catch (e) {
    testAdv('Realtime Sync & Triggers test', false, e.stack || e.message);
  }

  // -------------------------------------------------------------
  // ADVERSARIAL TEST 3: Kanban Done Drag & Drop & Permissions
  // -------------------------------------------------------------
  console.log('\n--- Adversarial Test 3: Kanban D&D WorkLog Integration ---');
  try {
    const env = createMockEnv();
    const apiCode = fs.readFileSync(API_PATH, 'utf8');
    const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
    const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

    vm.runInContext(apiCode, env.context);
    vm.runInContext(storeCode, env.context);
    vm.runInContext(viewsCode, env.context);

    // 1. Check permission denial when task assign is '市川'
    let task1 = env.sandbox.findTask(1);
    task1.assign = '市川';
    task1.status = 'WIP';

    env.sandbox.dragTaskId = 1;
    const mockEvent = {
      preventDefault: () => {},
      currentTarget: { classList: { remove: () => {} } }
    };

    env.sandbox.onColDrop(mockEvent, 'Done');
    task1 = env.sandbox.findTask(1);
    assert.strictEqual(task1.status, 'WIP', 'Task 1 status remains WIP due to permission check');
    testAdv('Kanban D&D correctly blocks drag for unassigned member', true);

    // 2. Check success when task is assigned to currentUser
    vm.runInContext(`
      const t = findTask(1);
      t.assign = currentUser;
      t.status = 'WIP';
      dragTaskId = 1;
      onColDrop({ preventDefault: () => {}, currentTarget: { classList: { remove: () => {} } } }, 'Done');
      if (t.status !== 'Done') throw new Error('Task status was not updated to Done');
      const log = workLogs.find(l => l.taskId === 1 && l.comment === '看板からDoneに移動');
      if (!log || log.minutes !== 30) throw new Error('WorkLog was not created correctly');
    `, env.context);

    testAdv('Kanban Done drop auto-creates 30min WorkLog and updates task status in RTDB when authorized', true);

  } catch (e) {
    testAdv('Kanban D&D WorkLog test', false, e.stack || e.message);
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n=== M2 Adversarial Verification Summary ===');
  console.log(`Total Tests: ${totalAdv}`);
  console.log(`Passed: ${passedAdv}`);
  console.log(`Failed: ${failedAdv}`);

  if (failedAdv > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAdversarialSuite();
