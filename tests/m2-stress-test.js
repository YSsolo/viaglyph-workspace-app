/**
 * Empirical Edge-Case & Stress Test Harness for Milestone 2
 * Tests:
 * 1. Behavior when RTDB returns null / empty objects for tasks, workLogs, goals, memberStatus, dailyMemos.
 * 2. Absence of unhandled promise rejections and sync/recursion loops.
 * 3. Correct structure of work log objects created from Kanban drops.
 * 4. Concurrent multi-client real-time synchronization integrity.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const API_PATH = path.join(ROOT_DIR, 'api.js');
const STORE_PATH = path.join(ROOT_DIR, 'store.js');
const VIEWS_PATH = path.join(ROOT_DIR, 'views.js');

console.log('=== Starting Milestone 2 Empirical Stress & Edge-Case Test Harness ===\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let unhandledRejections = [];

process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

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

function normalizeVmVal(val) {
  if (val === undefined) return undefined;
  return JSON.parse(JSON.stringify(val));
}

function createMockEnvironment(initialDataOverride = null) {
  const dbListeners = {};
  const dbData = initialDataOverride || {
    tasks: {
      dev: { 1: { id: 1, title: 'Dev Task 1', status: 'TODO', assign: '山口', ctx: 'dev', tags: ['dev'] } },
      biz: { 10: { id: 10, title: 'Biz Task 1', status: 'TODO', assign: '市川', ctx: 'biz', tags: ['biz'] } }
    },
    workLogs: {},
    goals: [{ id: 1, name: 'ViaGLYPH', icon: '🧠', bigGoals: [] }],
    memberStatus: { yamaguchi: 'online', ichikawa: 'away', murayama: 'online' },
    dailyMemos: { '2026-08-11': 'Initial Memo' }
  };

  let writeCount = 0;

  function getNode(p) {
    if (!p) return dbData;
    const parts = p.split('/').filter(Boolean);
    let curr = dbData;
    for (const part of parts) {
      if (curr === null || curr === undefined || typeof curr !== 'object') return undefined;
      curr = curr[part];
    }
    return curr;
  }

  function setNode(p, data) {
    writeCount++;
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
    writeCount++;
    const parts = p.split('/').filter(Boolean);
    let curr = dbData;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    curr[lastKey] = typeof curr[lastKey] === 'object' && curr[lastKey] !== null ? { ...curr[lastKey], ...data } : data;

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
      const key = 'key_' + Math.random().toString(36).substr(2, 9);
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

  const domElements = {};
  function getOrCreateElement(id) {
    if (!domElements[id]) {
      domElements[id] = {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        classList: {
          _classes: new Set(),
          add: function(c) { this._classes.add(c); },
          remove: function(c) { this._classes.delete(c); },
          contains: function(c) { return this._classes.has(c); },
          toggle: function(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
        },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
      };
    }
    return domElements[id];
  }

  const mockDocument = {
    getElementById: (id) => getOrCreateElement(id),
    querySelector: (selector) => getOrCreateElement('selector_' + selector),
    querySelectorAll: (selector) => [],
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
    get writeCount() { return writeCount; },
    resetWriteCount: () => { writeCount = 0; }
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
  return { context, sandbox, dbListeners, dbData, domElements };
}

// =============================================================
// SUITE 1: RTDB Null & Empty Data Handling
// =============================================================
console.log('--- Test Suite 1: RTDB Null & Empty Data Handling ---');

(async () => {
  try {
    const envNull = createMockEnvironment({ tasks: null, workLogs: null, goals: null, memberStatus: null, dailyMemos: null });
    const apiCode = fs.readFileSync(API_PATH, 'utf8');
    const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
    const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

    vm.runInContext(apiCode, envNull.context);
    vm.runInContext(storeCode, envNull.context);
    vm.runInContext(viewsCode, envNull.context);

    const API = vm.runInContext('API', envNull.context);

    const tasksVal = await API.getTasks();
    assert.ok(tasksVal && tasksVal.dev && tasksVal.biz, 'getTasks() should return object containing dev and biz keys');
    recordTest('getTasks() handles null RTDB node gracefully', true);

    const workLogsVal = await API.getWorkLogs();
    assert.deepStrictEqual(normalizeVmVal(workLogsVal), [], 'getWorkLogs() should return empty array [] when RTDB is null');
    recordTest('getWorkLogs() handles null RTDB node gracefully', true);

    const goalsVal = await API.getGoals();
    assert.deepStrictEqual(normalizeVmVal(goalsVal), [], 'getGoals() should return empty array [] when RTDB is null');
    recordTest('getGoals() handles null RTDB node gracefully', true);

    const memberStatusVal = await API.getMemberStatus();
    assert.deepStrictEqual(normalizeVmVal(memberStatusVal), {}, 'getMemberStatus() should return empty object {} when RTDB is null');
    recordTest('getMemberStatus() handles null RTDB node gracefully', true);

    const dailyMemosVal = await API.getDailyMemos();
    assert.deepStrictEqual(normalizeVmVal(dailyMemosVal), {}, 'getDailyMemos() should return empty object {} when RTDB is null');
    recordTest('getDailyMemos() handles null RTDB node gracefully', true);

    // Test 1.2: syncAll() when RTDB nodes return empty/null
    const syncRes = await API.syncAll();
    assert.ok(syncRes, 'syncAll() completes without throwing');
    recordTest('syncAll() handles null RTDB data without error', true);

    // Test 1.3: Realtime listeners triggering with null values
    API.initRealtimeListeners();
    envNull.dbListeners['tasks']?.forEach(cb => cb({ val: () => null }));
    envNull.dbListeners['workLogs']?.forEach(cb => cb({ val: () => null }));
    envNull.dbListeners['goals']?.forEach(cb => cb({ val: () => null }));
    envNull.dbListeners['memberStatus']?.forEach(cb => cb({ val: () => null }));
    envNull.dbListeners['dailyMemos']?.forEach(cb => cb({ val: () => null }));
    recordTest('Realtime listeners handle null snaps without throwing errors or breaking UI', true);

  } catch (e) {
    recordTest('RTDB Null & Empty Data Handling', false, e.stack || e.message);
  }

  // =============================================================
  // SUITE 2: Unhandled Promise Rejections & Sync Loops
  // =============================================================
  console.log('\n--- Test Suite 2: Absence of Unhandled Promise Rejections & Sync Loops ---');

  try {
    const env = createMockEnvironment();
    const apiCode = fs.readFileSync(API_PATH, 'utf8');
    const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
    const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

    vm.runInContext(apiCode, env.context);
    vm.runInContext(storeCode, env.context);
    vm.runInContext(viewsCode, env.context);

    // Force network rejection
    env.sandbox.firebase.database = () => ({
      ref: () => ({
        once: () => Promise.reject(new Error('Network error (simulated)')),
        set: () => Promise.reject(new Error('Network error (simulated)')),
        update: () => Promise.reject(new Error('Network error (simulated)')),
        push: () => ({ set: () => Promise.reject(new Error('Network error (simulated)')), key: 'fail_key' }),
        on: (ev, cb) => {},
        off: () => {}
      })
    });

    vm.runInContext("addWorkLog(1, 30, ['dev'], 'Test log under network failure')", env.context);
    vm.runInContext("saveDailyMemo()", env.context);
    vm.runInContext("cycleMemberStatus('yamaguchi')", env.context);

    await new Promise(resolve => setTimeout(resolve, 100));

    assert.strictEqual(unhandledRejections.length, 0, `Expected 0 unhandled rejections, but found ${unhandledRejections.length}`);
    recordTest('No unhandled promise rejections during network failures / DB rejections', true);

    // Sync Loop Detection
    const envLoop = createMockEnvironment();
    vm.runInContext(apiCode, envLoop.context);
    vm.runInContext(storeCode, envLoop.context);
    vm.runInContext(viewsCode, envLoop.context);

    const APILoop = vm.runInContext('API', envLoop.context);
    APILoop.initRealtimeListeners();
    envLoop.sandbox.resetWriteCount();

    // Set currentUser to match task assignment
    vm.runInContext("currentUser = '山口'", envLoop.context);
    vm.runInContext("DATA.dev.tasks[0].assign = '山口'", envLoop.context);
    vm.runInContext("dragTaskId = 1", envLoop.context);
    vm.runInContext("mockDropEvent = { preventDefault: () => {}, currentTarget: { classList: { remove: () => {} } } }", envLoop.context);

    vm.runInContext("onColDrop(mockDropEvent, 'Done')", envLoop.context);

    await new Promise(resolve => setTimeout(resolve, 50));

    const writes = envLoop.sandbox.writeCount;
    assert.ok(writes <= 4, `Write count after single Kanban drop should be small (got ${writes}), indicating no cascade loop`);
    recordTest('Absence of sync / cascading write loops on state mutation', true);

  } catch (e) {
    recordTest('Unhandled Promise Rejections & Sync Loops', false, e.stack || e.message);
  }

  // =============================================================
  // SUITE 3: Kanban Drop WorkLog Structure Verification
  // =============================================================
  console.log('\n--- Test Suite 3: Kanban Drop WorkLog Object Structure ---');

  try {
    const envWorkLog = createMockEnvironment();
    const apiCode = fs.readFileSync(API_PATH, 'utf8');
    const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
    const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

    vm.runInContext(apiCode, envWorkLog.context);
    vm.runInContext(storeCode, envWorkLog.context);
    vm.runInContext(viewsCode, envWorkLog.context);

    const API = vm.runInContext('API', envWorkLog.context);
    API.initRealtimeListeners();

    // Set currentUser to '山口' and assign task 1 to '山口'
    vm.runInContext("currentUser = '山口'", envWorkLog.context);
    vm.runInContext("DATA.dev.tasks[0].assign = '山口'", envWorkLog.context);
    vm.runInContext("DATA.dev.tasks[0].tags = ['開発', '未踏']", envWorkLog.context);

    // Perform drop of task 1 to 'Done'
    vm.runInContext("dragTaskId = 1", envWorkLog.context);
    vm.runInContext("mockDropEvent = { preventDefault: () => {}, currentTarget: { classList: { remove: () => {} } } }", envWorkLog.context);
    vm.runInContext("onColDrop(mockDropEvent, 'Done')", envWorkLog.context);

    const rawLogs = vm.runInContext("workLogs", envWorkLog.context);
    const logs = normalizeVmVal(rawLogs);
    assert.ok(logs && logs.length > 0, 'workLogs array contains created log');
    const latestLog = logs[logs.length - 1];

    assert.strictEqual(latestLog.taskId, 1, 'workLog.taskId matches task.id (1)');
    assert.strictEqual(latestLog.minutes, 30, 'workLog.minutes equals 30');
    assert.deepStrictEqual(latestLog.tags, ['開発', '未踏'], 'workLog.tags matches task.tags');
    assert.strictEqual(latestLog.comment, '看板からDoneに移動', 'workLog.comment matches standard drop comment');
    assert.strictEqual(latestLog.user, '山口', 'workLog.user matches currentUser');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(latestLog.date), 'workLog.date is in YYYY-MM-DD format');
    assert.ok(!isNaN(Date.parse(latestLog.createdAt)), 'workLog.createdAt is a valid ISO date string');

    recordTest('WorkLog created from Kanban drop has complete & correct structure', true);

    const rtdbLogs = envWorkLog.sandbox.dbData.workLogs;
    const rtdbLogKeys = Object.keys(rtdbLogs);
    assert.ok(rtdbLogKeys.length > 0, 'RTDB workLogs node received new entry');
    const rtdbEntry = normalizeVmVal(rtdbLogs[rtdbLogKeys[rtdbLogKeys.length - 1]]);
    assert.strictEqual(rtdbEntry.taskId, 1, 'RTDB workLog entry taskId matches 1');
    assert.strictEqual(rtdbEntry.user, '山口', 'RTDB workLog entry user matches "山口"');

    recordTest('WorkLog created from Kanban drop is properly persisted to RTDB', true);

  } catch (e) {
    recordTest('Kanban Drop WorkLog Structure', false, e.stack || e.message);
  }

  // =============================================================
  // SUITE 4: Multi-Client Real-Time Synchronization Simulation
  // =============================================================
  console.log('\n--- Test Suite 4: Multi-Client Real-Time Synchronization ---');

  try {
    const sharedRTDB = {
      tasks: {
        dev: { 1: { id: 1, title: 'Shared Task 1', status: 'TODO', assign: '山口', ctx: 'dev', tags: ['dev'] } }
      },
      workLogs: {},
      goals: [],
      memberStatus: { yamaguchi: 'online', ichikawa: 'offline', murayama: 'offline' },
      dailyMemos: {}
    };

    const listeners = { tasks: [], workLogs: [], goals: [], memberStatus: [], dailyMemos: [] };

    function createClientEnv(clientName) {
      const storageMap = {};
      const mockLocalStorage = {
        getItem: (k) => storageMap[k] || null,
        setItem: (k, v) => { storageMap[k] = String(v); },
        removeItem: (k) => { delete storageMap[k]; }
      };

      const domElements = {};
      function getOrCreateElement(id) {
        if (!domElements[id]) {
          domElements[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false } };
        }
        return domElements[id];
      }

      const mockDocument = { getElementById: getOrCreateElement, querySelector: () => getOrCreateElement('q'), querySelectorAll: () => [], addEventListener: () => {} };
      const mockWindow = { document: mockDocument, localStorage: mockLocalStorage, addEventListener: () => {}, location: { reload: () => {} } };
      mockWindow.window = mockWindow;

      const mockDbRef = (refPath) => ({
        on: (ev, cb) => {
          if (!listeners[refPath]) listeners[refPath] = [];
          listeners[refPath].push(cb);
          cb({ val: () => sharedRTDB[refPath] });
        },
        off: () => {},
        once: (ev) => Promise.resolve({ val: () => sharedRTDB[refPath] }),
        set: (data) => {
          const parts = refPath.split('/').filter(Boolean);
          let curr = sharedRTDB;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!curr[parts[i]]) curr[parts[i]] = {};
            curr = curr[parts[i]];
          }
          curr[parts[parts.length - 1]] = data;
          const root = parts[0];
          if (listeners[root]) listeners[root].forEach(cb => cb({ val: () => sharedRTDB[root] }));
          return Promise.resolve();
        },
        update: (data) => {
          const parts = refPath.split('/').filter(Boolean);
          let curr = sharedRTDB;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!curr[parts[i]]) curr[parts[i]] = {};
            curr = curr[parts[i]];
          }
          const lastKey = parts[parts.length - 1];
          curr[lastKey] = { ...curr[lastKey], ...data };
          const root = parts[0];
          if (listeners[root]) listeners[root].forEach(cb => cb({ val: () => sharedRTDB[root] }));
          return Promise.resolve();
        },
        push: () => {
          const key = 'key_' + Math.random().toString(36).substr(2, 6);
          return {
            key,
            set: (data) => {
              if (!sharedRTDB[refPath]) sharedRTDB[refPath] = {};
              sharedRTDB[refPath][key] = data;
              const root = refPath.split('/')[0];
              if (listeners[root]) listeners[root].forEach(cb => cb({ val: () => sharedRTDB[root] }));
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

      const sandbox = vm.createContext(new Proxy({
        window: mockWindow, document: mockDocument, localStorage: mockLocalStorage, firebase: mockFirebase,
        console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Array, Object, Promise, parseInt, parseFloat
      }, {
        get(t, p) { return p in t ? t[p] : p in mockWindow ? mockWindow[p] : globalThis[p]; },
        set(t, p, v) { t[p] = v; mockWindow[p] = v; return true; }
      }));

      const apiCode = fs.readFileSync(API_PATH, 'utf8');
      const storeCode = fs.readFileSync(STORE_PATH, 'utf8');
      const viewsCode = fs.readFileSync(VIEWS_PATH, 'utf8');

      vm.runInContext(apiCode, sandbox);
      vm.runInContext(storeCode, sandbox);
      vm.runInContext(viewsCode, sandbox);

      const API = vm.runInContext('API', sandbox);
      API.initRealtimeListeners();
      return sandbox;
    }

    const clientA = createClientEnv('Client A');
    const clientB = createClientEnv('Client B');

    // Client A updates Task #1 status to 'WIP'
    const API_A = vm.runInContext('API', clientA);
    await API_A.updateTask(1, { status: 'WIP' }, 'dev');

    // Check if Client B's DATA object updated instantly via listener
    const bDevTask = vm.runInContext('DATA.dev.tasks[0]', clientB);
    assert.strictEqual(bDevTask.status, 'WIP', "Client B's DATA.dev.tasks[0].status should instantly update to 'WIP'");
    recordTest('Multi-client real-time task update propagation verified', true);

    // Client B updates member status to 'away'
    const API_B = vm.runInContext('API', clientB);
    await API_B.updateMemberStatus('山口', 'away');

    // Check if Client A's memberStatuses updated instantly
    const aMemberStatus = vm.runInContext('memberStatuses.yamaguchi', clientA);
    assert.strictEqual(aMemberStatus, 'away', "Client A's memberStatuses.yamaguchi should instantly update to 'away'");
    recordTest('Multi-client real-time member status update propagation verified', true);

  } catch (e) {
    recordTest('Multi-Client Real-Time Synchronization', false, e.stack || e.message);
  }

  // SUMMARY
  console.log('\n=== Stress Test Summary ===');
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests > 0) {
    console.error('\nStress Test Result: VERDICT = REQUEST_CHANGES');
    process.exit(1);
  } else {
    console.log('\nStress Test Result: VERDICT = APPROVE');
    process.exit(0);
  }
})();
