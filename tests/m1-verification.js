/**
 * Empirical Verification Test Suite for Milestone 1
 * Global Firebase Initialization Consolidation
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT_DIR, 'api.js');
const CANVAS_PATH = path.join(ROOT_DIR, 'canvas.js');
const HTML_PATH = path.join(ROOT_DIR, 'index.html');

console.log('=== Starting Milestone 1 Empirical Verification Suite ===\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

function recordTest(name, passed, detail = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } else {
    failedTests++;
    console.log(`  [FAIL] ${name}: ${detail}`);
  }
  testResults.push({ name, passed, detail });
}

// -------------------------------------------------------------
// TEST 1: Syntax Correctness
// -------------------------------------------------------------
console.log('--- Test Suite 1: Syntax Verification ---');
try {
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  new vm.Script(apiCode, { filename: 'api.js' });
  recordTest('api.js syntax check', true);
} catch (e) {
  recordTest('api.js syntax check', false, e.message);
}

try {
  const canvasCode = fs.readFileSync(CANVAS_PATH, 'utf8');
  new vm.Script(canvasCode, { filename: 'canvas.js' });
  recordTest('canvas.js syntax check', true);
} catch (e) {
  recordTest('canvas.js syntax check', false, e.message);
}

// -------------------------------------------------------------
// TEST 2: Mock Environment Execution Test
// -------------------------------------------------------------
console.log('\n--- Test Suite 2: Mock Environment Execution ---');

function createMockEnvironment(options = {}) {
  const initCalls = [];
  const mockAppInstance = { name: '[DEFAULT]' };
  const mockDbInstance = {
    ref: (path) => ({
      off: () => {},
      on: () => {},
      set: () => {},
      push: () => ({ key: 'mock-key' }),
      update: () => {},
      remove: () => Promise.resolve()
    })
  };
  const mockStorageInstance = {};

  const mockFirebase = {
    apps: options.existingApps ? [mockAppInstance] : [],
    initializeApp: (config) => {
      initCalls.push(config);
      const app = { name: '[DEFAULT]', config };
      mockFirebase.apps.push(app);
      return app;
    },
    app: () => mockFirebase.apps[0] || mockAppInstance,
    database: () => mockDbInstance,
    storage: () => mockStorageInstance
  };

  const mockDocument = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    activeElement: null,
    createRange: () => ({ selectNodeContents: () => {} })
  };

  const mockLocalStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };

  const mockWindow = {
    document: mockDocument,
    localStorage: mockLocalStorage,
    getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {}, rangeCount: 0, toString: () => '' }),
    addEventListener: () => {},
    removeEventListener: () => {},
    confirm: () => true
  };

  mockWindow.window = mockWindow;

  const sandbox = new Proxy({
    window: mockWindow,
    document: mockDocument,
    localStorage: mockLocalStorage,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    confirm: () => true,
    initCalls
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop in mockWindow) return mockWindow[prop];
      return undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      mockWindow[prop] = value;
      return true;
    },
    has(target, prop) {
      return (prop in target) || (prop in mockWindow);
    }
  });

  if (!options.omitFirebase) {
    sandbox.firebase = mockFirebase;
    mockWindow.firebase = mockFirebase;
  }

  const context = vm.createContext(sandbox);
  return { context, sandbox, mockFirebase, mockDbInstance, initCalls };
}

// Subtest 2.1: api.js execution with Firebase present
try {
  const { context, sandbox, initCalls } = createMockEnvironment();
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  vm.runInContext(apiCode, context);

  const window = sandbox.window;
  assert.ok(window.FIREBASE_CONFIG, 'window.FIREBASE_CONFIG should be defined');
  assert.strictEqual(window.FIREBASE_CONFIG.projectId, 'viaglyph-workspace', 'FIREBASE_CONFIG.projectId matches');
  assert.strictEqual(window.FIREBASE_CONFIG.databaseURL, 'https://viaglyph-workspace-default-rtdb.firebaseio.com', 'FIREBASE_CONFIG.databaseURL matches');
  assert.ok(window.firebaseApp, 'window.firebaseApp should be defined');
  assert.ok(window.firebaseDb, 'window.firebaseDb should be defined');
  assert.strictEqual(initCalls.length, 1, 'firebase.initializeApp should be called exactly once');

  recordTest('api.js initializes FIREBASE_CONFIG, firebaseApp, and firebaseDb', true);
} catch (e) {
  recordTest('api.js initializes FIREBASE_CONFIG, firebaseApp, and firebaseDb', false, e.stack || e.message);
}

// Subtest 2.2: canvas.js execution & integration after api.js
try {
  const { context, sandbox, initCalls } = createMockEnvironment();
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  const canvasCode = fs.readFileSync(CANVAS_PATH, 'utf8');

  vm.runInContext(apiCode, context);
  vm.runInContext(canvasCode, context);

  const window = sandbox.window;
  assert.ok(typeof context.initFirebase === 'function', 'initFirebase function is exposed');

  // Call initFirebase from canvas.js
  const dbResult = vm.runInContext('initFirebase()', context);
  assert.strictEqual(dbResult, window.firebaseDb, 'initFirebase returns window.firebaseDb');
  assert.strictEqual(initCalls.length, 1, 'initFirebase does NOT re-initialize firebase app if window.firebaseApp is present');

  recordTest('canvas.js integrates cleanly with api.js initialized globals', true);
} catch (e) {
  recordTest('canvas.js integrates cleanly with api.js initialized globals', false, e.stack || e.message);
}

// -------------------------------------------------------------
// TEST 3: Re-entrancy & Double Initialization
// -------------------------------------------------------------
console.log('\n--- Test Suite 3: Re-entrancy & Double Initialization ---');

// Subtest 3.1: Idempotency of initFirebase
try {
  const { context, sandbox, initCalls } = createMockEnvironment();
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  const canvasCode = fs.readFileSync(CANVAS_PATH, 'utf8');

  vm.runInContext(apiCode, context);
  vm.runInContext(canvasCode, context);

  // Call initFirebase multiple times
  const res1 = vm.runInContext('initFirebase()', context);
  const res2 = vm.runInContext('initFirebase()', context);
  const res3 = vm.runInContext('initFirebase()', context);

  assert.strictEqual(res1, res2, 'Multiple initFirebase calls return same DB instance');
  assert.strictEqual(res2, res3, 'Multiple initFirebase calls return same DB instance');
  assert.strictEqual(initCalls.length, 1, 'No additional firebase.initializeApp calls on re-entrancy');

  recordTest('initFirebase is idempotent across multiple sequential calls', true);
} catch (e) {
  recordTest('initFirebase is idempotent across multiple sequential calls', false, e.stack || e.message);
}

// Subtest 3.2: Existing firebase apps array (pre-existing app instance)
try {
  const { context, sandbox, initCalls } = createMockEnvironment({ existingApps: true });
  const apiCode = fs.readFileSync(API_PATH, 'utf8');

  vm.runInContext(apiCode, context);

  assert.strictEqual(initCalls.length, 0, 'initializeApp not called when firebase.apps is non-empty');
  assert.ok(sandbox.window.firebaseApp, 'window.firebaseApp assigned from firebase.app()');
  assert.ok(sandbox.window.firebaseDb, 'window.firebaseDb assigned');

  recordTest('api.js reuses existing firebase.app() when firebase.apps has existing app', true);
} catch (e) {
  recordTest('api.js reuses existing firebase.app() when firebase.apps has existing app', false, e.stack || e.message);
}

// -------------------------------------------------------------
// TEST 4: Edge Cases & Failure Modes
// -------------------------------------------------------------
console.log('\n--- Test Suite 4: Edge Cases & Failure Modes ---');

// Subtest 4.1: Graceful handling when firebase script is omitted/missing
try {
  const { context, sandbox } = createMockEnvironment({ omitFirebase: true });
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  const canvasCode = fs.readFileSync(CANVAS_PATH, 'utf8');

  vm.runInContext(apiCode, context);
  assert.ok(sandbox.window.FIREBASE_CONFIG, 'window.FIREBASE_CONFIG is defined even if firebase is undefined');
  assert.strictEqual(sandbox.window.firebaseApp, undefined, 'window.firebaseApp is undefined');
  assert.strictEqual(sandbox.window.firebaseDb, undefined, 'window.firebaseDb is undefined');

  vm.runInContext(canvasCode, context);
  const dbResult = vm.runInContext('initFirebase()', context);
  assert.strictEqual(dbResult, undefined, 'initFirebase safely returns undefined when firebase is missing');

  recordTest('Graceful execution when firebase SDK is absent', true);
} catch (e) {
  recordTest('Graceful execution when firebase SDK is absent', false, e.stack || e.message);
}

// Subtest 4.2: Fallback initialization in canvas.js if api.js did not set window.firebaseApp
try {
  const { context, sandbox, initCalls } = createMockEnvironment();
  const canvasCode = fs.readFileSync(CANVAS_PATH, 'utf8');

  // Set window.FIREBASE_CONFIG manually without running api.js
  sandbox.window.FIREBASE_CONFIG = { apiKey: 'test-key', databaseURL: 'https://test.firebaseio.com' };
  vm.runInContext(canvasCode, context);

  const dbResult = vm.runInContext('initFirebase()', context);
  assert.ok(dbResult, 'initFirebase initializes DB if api.js did not run');
  assert.ok(sandbox.window.firebaseApp, 'window.firebaseApp set by canvas fallback');
  assert.ok(sandbox.window.firebaseDb, 'window.firebaseDb set by canvas fallback');
  assert.strictEqual(initCalls.length, 1, 'initCalls count is 1 from canvas fallback');

  recordTest('canvas.js fallback initFirebase works when api.js has not set globals', true);
} catch (e) {
  recordTest('canvas.js fallback initFirebase works when api.js has not set globals', false, e.stack || e.message);
}

// Subtest 4.3: Verify global variable `firebaseDb` resolution in canvas.js functions
try {
  const { context, sandbox } = createMockEnvironment();
  const apiCode = fs.readFileSync(API_PATH, 'utf8');
  const canvasCode = fs.readFileSync(CANVAS_PATH, 'utf8');

  vm.runInContext(apiCode, context);
  vm.runInContext(canvasCode, context);

  // Assert that global firebaseDb evaluates to window.firebaseDb inside canvas context
  const evalDb = vm.runInContext('firebaseDb', context);
  assert.strictEqual(evalDb, sandbox.window.firebaseDb, 'Global variable firebaseDb matches window.firebaseDb');

  recordTest('Global variable firebaseDb in canvas.js resolves to window.firebaseDb', true);
} catch (e) {
  recordTest('Global variable firebaseDb in canvas.js resolves to window.firebaseDb', false, e.stack || e.message);
}

// -------------------------------------------------------------
// TEST 5: HTML Script Load Order & Integrity Verification
// -------------------------------------------------------------
console.log('\n--- Test Suite 5: HTML Script Order Integrity ---');

try {
  const htmlContent = fs.readFileSync(HTML_PATH, 'utf8');

  const scriptSrcRegex = /<script\s+[^>]*src=["']([^"']+)["']/gi;
  const scriptSources = [];
  let match;
  while ((match = scriptSrcRegex.exec(htmlContent)) !== null) {
    scriptSources.push(match[1]);
  }

  console.log('  Detected scripts in index.html:');
  scriptSources.forEach((src, idx) => console.log(`    ${idx + 1}. ${src}`));

  const idxApp = scriptSources.findIndex(s => s.includes('firebase-app-compat'));
  const idxDb = scriptSources.findIndex(s => s.includes('firebase-database-compat'));
  const idxStorage = scriptSources.findIndex(s => s.includes('firebase-storage-compat'));
  const idxApi = scriptSources.findIndex(s => s.includes('api.js'));
  const idxStore = scriptSources.findIndex(s => s.includes('store.js'));
  const idxViews = scriptSources.findIndex(s => s.includes('views.js'));
  const idxCanvas = scriptSources.findIndex(s => s.includes('canvas.js'));

  assert.ok(idxApp !== -1, 'firebase-app-compat script present');
  assert.ok(idxDb !== -1, 'firebase-database-compat script present');
  assert.ok(idxStorage !== -1, 'firebase-storage-compat script present');
  assert.ok(idxApi !== -1, 'api.js script present');
  assert.ok(idxCanvas !== -1, 'canvas.js script present');

  assert.ok(idxApp < idxDb, 'firebase-app loaded before firebase-database');
  assert.ok(idxDb < idxStorage, 'firebase-database loaded before firebase-storage');
  assert.ok(idxStorage < idxApi, 'firebase-storage loaded before api.js');
  assert.ok(idxApi < idxStore, 'api.js loaded before store.js');
  assert.ok(idxStore < idxViews, 'store.js loaded before views.js');
  assert.ok(idxViews < idxCanvas, 'views.js loaded before canvas.js');

  recordTest('index.html script load order is correct (Firebase SDKs -> api.js -> store.js -> views.js -> canvas.js)', true);
} catch (e) {
  recordTest('index.html script load order is correct', false, e.stack || e.message);
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
