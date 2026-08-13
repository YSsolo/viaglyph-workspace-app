/**
 * Empirical Verification Test Suite for Milestone 2
 * RTDB Data Access Layer & Realtime Synchronization
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT_DIR, 'api.js');
const STORE_PATH = path.join(ROOT_DIR, 'store.js');
const VIEWS_PATH = path.join(ROOT_DIR, 'views.js');

console.log('=== Starting Milestone 2 Empirical Verification Suite ===\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function recordTest(name, passed, detail = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } else {
    failedTests++;
    console.log(`  [FAIL] ${name}: ${detail}`);
  }
}

// -------------------------------------------------------------
// TEST 1: Syntax Correctness & GAS Elimination
// -------------------------------------------------------------
console.log('--- Test Suite 1: Syntax & Zero-GAS Verification ---');

try {
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  new vm.Script(apiCode, { filename: 'api.js' });
  recordTest('api.js syntax check', true);

  assert.strictEqual(apiCode.includes('GAS_URL'), false, 'api.js must not contain GAS_URL');
  assert.strictEqual(apiCode.includes('script.google.com'), false, 'api.js must not reference script.google.com');
  recordTest('api.js zero GAS dependency check', true);
} catch (e) {
  recordTest('api.js syntax / zero-GAS check', false, e.message);
}

try {
  const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
  new vm.Script(storeCode, { filename: 'store.js' });
  recordTest('store.js syntax check', true);

  assert.ok(storeCode.includes('function saveLocal()'), 'store.js must contain saveLocal() function');
  recordTest('store.js saveLocal separation check', true);
} catch (e) {
  recordTest('store.js syntax check', false, e.message);
}

try {
  const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');
  new vm.Script(viewsCode, { filename: 'views.js' });
  recordTest('views.js syntax check', true);
} catch (e) {
  recordTest('views.js syntax check', false, e.message);
}

// -------------------------------------------------------------
// TEST 2: API Method Contracts & Firebase Direct Operations
// -------------------------------------------------------------
console.log('\n--- Test Suite 2: API Method Contracts ---');

function createMockEnvironment() {
  const dbListeners = {};
  const dbData = {
    tasks: { dev: { 1: { id: 1, title: 'Test Task', status: 'TODO', ctx: 'dev', tags: ['dev'] } } },
    workLogs: [{ id: 'wl-1', taskId: 1, minutes: 30, user: '山口', date: '2026-08-11' }],
    goals: [{ id: 1, name: 'Project 1', bigGoals: [] }],
    memberStatus: { yamaguchi: 'online', ichikawa: 'away', murayama: 'online' },
    dailyMemos: { '2026-08-11': 'Memo text' }
  };

  function getNode(p) {
    const parts = p.split('/').filter(Boolean);
    let curr = dbData;
    for (const part of parts) {
      if (!curr[part]) return undefined;
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
    // Trigger root listeners if any match first segment
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
    curr[lastKey] = typeof curr[lastKey] === 'object' ? { ...curr[lastKey], ...data } : data;
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
    apps: [{ name: '[DEFAULT]' }],
    app: () => mockFirebase.apps[0],
    database: () => ({ ref: mockDbRef })
  };

  const storageMap = {};
  const mockLocalStorage = {
    getItem: (k) => storageMap[k] || null,
    setItem: (k, v) => { storageMap[k] = String(v); },
    removeItem: (k) => { delete storageMap[k]; }
  };

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
    dbData
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
  return { context, sandbox, dbListeners, dbData, storageMap };
}

try {
  const { context, sandbox } = createMockEnvironment();
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  vm.runInContext(apiCode, context);

  const API = sandbox.window.API || sandbox.API;
  assert.ok(API, 'API object exists');

  const requiredMethods = [
    'login', 'validateToken', 'logout', 'getTasks', 'getWorkLogs',
    'getGoals', 'getMemberStatus', 'getDailyMemos', 'addTask',
    'updateTask', 'addWorkLog', 'saveGoals', 'updateMemberStatus',
    'saveDailyMemo', 'sendSlackMessage', 'createSlackCanvas',
    'initRealtimeListeners', 'detachRealtimeListeners'
  ];

  requiredMethods.forEach(method => {
    assert.strictEqual(typeof API[method], 'function', `API.${method} must be a function`);
  });

  recordTest('All 14+ required API methods are defined and callable', true);
} catch (e) {
  recordTest('API methods definition check', false, e.stack || e.message);
}

// -------------------------------------------------------------
// TEST 3: Realtime Listener & Multi-Client State Sync Simulation
// -------------------------------------------------------------
console.log('\n--- Test Suite 3: Realtime Listener & State Synchronization ---');

try {
  const env = createMockEnvironment();
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
  const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

  vm.runInContext(apiCode, env.context);
  vm.runInContext(storeCode, env.context);
  vm.runInContext(viewsCode, env.context);

  const API = env.sandbox.window.API || env.sandbox.API;

  // Initialize listeners
  API.initRealtimeListeners();
  assert.ok(API._listenersAttached, '_listenersAttached flag set to true');
  assert.ok(env.dbListeners['tasks'], 'Listener attached to /tasks');
  assert.ok(env.dbListeners['workLogs'], 'Listener attached to /workLogs');
  assert.ok(env.dbListeners['goals'], 'Listener attached to /goals');
  assert.ok(env.dbListeners['memberStatus'], 'Listener attached to /memberStatus');
  assert.ok(env.dbListeners['dailyMemos'], 'Listener attached to /dailyMemos');

  recordTest('initRealtimeListeners attaches listeners to all 5 RTDB paths', true);

  // Test updating task via API updates RTDB
  API.updateTask(1, { status: 'Done' }, 'dev');
  assert.strictEqual(env.dbData.tasks.dev[1].status, 'Done', 'RTDB data updated by API.updateTask');

  recordTest('API.updateTask correctly updates RTDB node', true);
} catch (e) {
  recordTest('Realtime Listener & State Synchronization test', false, e.stack || e.message);
}

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n=== Verification Summary ===');
console.log(`Total Tests: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);

if (failedTests > 0) {
  console.error('\nResult: VERDICT = REQUEST_CHANGES');
  process.exit(1);
} else {
  console.log('\nResult: VERDICT = APPROVE');
  process.exit(0);
}
