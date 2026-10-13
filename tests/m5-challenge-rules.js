/**
 * Empirical Challenge Test Script for Milestone 5
 * Validates the PM v2 (/pm/tasks) schema validation rules.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const RULES_PATH = path.join(__dirname, '..', 'database.rules.json');
const README_PATH = path.join(__dirname, '..', 'README.md');

console.log('=== Milestone 5 Empirical Challenge Verification ===\n');

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
// TASK 1: database.rules.json empirical evaluation
// -------------------------------------------------------------
console.log('--- Task 1: database.rules.json Validation Engine Test ---');

class RuleDataSnapshot {
  constructor(val) {
    this._val = val;
  }
  exists() {
    return this._val !== undefined && this._val !== null;
  }
  isString() {
    return typeof this._val === 'string';
  }
  isNumber() {
    return typeof this._val === 'number';
  }
  isBoolean() {
    return typeof this._val === 'boolean';
  }
  val() {
    return this._val;
  }
  hasChildren(keys) {
    if (!this._val || typeof this._val !== 'object') return false;
    if (!keys) return Array.isArray(this._val) ? this._val.length > 0 : Object.keys(this._val).length > 0;
    return keys.every(k => k in this._val && this._val[k] !== undefined && this._val[k] !== null);
  }
  child(key) {
    if (this._val && typeof this._val === 'object') {
      return new RuleDataSnapshot(this._val[key]);
    }
    return new RuleDataSnapshot(undefined);
  }
}

let rulesJson;
try {
  const content = fs.readFileSync(RULES_PATH, 'utf8');
  rulesJson = JSON.parse(content);
  recordTest('database.rules.json parsing', true);
} catch (e) {
  recordTest('database.rules.json parsing', false, e.message);
  process.exit(1);
}

const taskNodeRules = rulesJson.rules.pm.tasks.$task_id;

function evaluateTaskRule(taskObj, taskId = 'task-101') {
  // Root task validate
  const taskSnap = new RuleDataSnapshot(taskObj);
  const taskRootExpr = taskNodeRules['.validate'];
  
  const rootFn = new Function('newData', '$task_id', `return ${taskRootExpr};`);
  if (!rootFn(taskSnap, taskId)) {
    return false;
  }

  // Children validations
  for (const field of Object.keys(taskNodeRules)) {
    if (field === '.validate') continue;
    const childRule = taskNodeRules[field]['.validate'];
    const childSnap = taskSnap.child(field);
    const childFn = new Function('newData', `return ${childRule};`);
    if (!childFn(childSnap)) {
      return false;
    }
  }
  return true;
}

// Baseline valid PM v2 task. Backlog intentionally permits unassigned work.
const baseValidTask = {
  id: 'task-101',
  projectId: 'project-1',
  milestoneId: 'milestone-1',
  title: 'Test Task Title',
  status: 'backlog',
  assignees: [],
  dueDate: '',
  priority: 'medium',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  updatedBy: '174987576'
};

// Test Case 1: Backlog allows an empty due date and no assignee.
try {
  assert.strictEqual(evaluateTaskRule(baseValidTask), true, 'Backlog task must pass validation');
  recordTest('Backlog task without assignee or due date passes validation', true);
} catch (e) {
  recordTest('Backlog task without assignee or due date passes validation', false, e.message);
}

// Test Case 2: Todo requires both assignee and due date.
try {
  const persistedBacklog = { ...baseValidTask };
  delete persistedBacklog.assignees; // RTDB removes empty arrays.
  assert.strictEqual(evaluateTaskRule(persistedBacklog), true, 'Persisted unassigned backlog must pass validation');
  recordTest('RTDB-normalized backlog passes validation', true);
} catch (e) {
  recordTest('RTDB-normalized backlog passes validation', false, e.message);
}

try {
  const todo = { ...baseValidTask, status: 'todo', assignees: ['山口'], dueDate: '2026-09-30' };
  assert.strictEqual(evaluateTaskRule(todo), true, 'Assigned todo with due date must pass validation');
  recordTest('Todo with assignee and due date passes validation', true);
} catch (e) {
  recordTest('Todo with assignee and due date passes validation', false, e.message);
}

// Test Case 3: A non-backlog task cannot omit an assignee.
try {
  const todo = { ...baseValidTask, status: 'todo', dueDate: '2026-09-30' };
  assert.strictEqual(evaluateTaskRule(todo), false, 'Unassigned todo must fail validation');
  recordTest('Todo without assignee fails validation', true);
} catch (e) {
  recordTest('Todo without assignee fails validation', false, e.message);
}

// Test Case 4: A non-backlog task cannot omit a due date.
try {
  const todo = { ...baseValidTask, status: 'todo', assignees: ['山口'] };
  assert.strictEqual(evaluateTaskRule(todo), false, 'Todo without due date must fail validation');
  recordTest('Todo without due date fails validation', true);
} catch (e) {
  recordTest('Todo without due date fails validation', false, e.message);
}

// Test Case 5: Invalid status and priority values are rejected.
const invalidStatuses = ['INVALID_STATUS', 'TODO', 123, null];
invalidStatuses.forEach(invStatus => {
  try {
    const taskWithInvalidStatus = { ...baseValidTask, status: invStatus };
    const isValid = evaluateTaskRule(taskWithInvalidStatus);
    assert.strictEqual(isValid, false, `Task with invalid status '${invStatus}' must fail validation`);
    recordTest(`Task with invalid status '${invStatus}' fails validation`, true);
  } catch (e) {
    recordTest(`Task with invalid status '${invStatus}' fails validation`, false, e.message);
  }
});

try {
  assert.strictEqual(evaluateTaskRule({ ...baseValidTask, priority: 'urgent' }), false, 'Invalid priority must fail validation');
  recordTest('Task with invalid priority fails validation', true);
} catch (e) {
  recordTest('Task with invalid priority fails validation', false, e.message);
}

// Test Case 6: All formal states require assignment and due date except backlog.
const validStatuses = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'];
validStatuses.forEach(valStatus => {
  try {
    const taskWithValidStatus = valStatus === 'backlog'
      ? { ...baseValidTask, status: valStatus }
      : { ...baseValidTask, status: valStatus, assignees: ['山口'], dueDate: '2026-09-30' };
    const isValid = evaluateTaskRule(taskWithValidStatus);
    assert.strictEqual(isValid, true, `Task with status '${valStatus}' must pass validation`);
    recordTest(`Task with valid status '${valStatus}' passes validation`, true);
  } catch (e) {
    recordTest(`Task with valid status '${valStatus}' passes validation`, false, e.message);
  }
});


// -------------------------------------------------------------
// TASK 2: README.md test files existence check
// -------------------------------------------------------------
console.log('\n--- Task 2: README.md Test Files Disk Existence Check ---');

const expectedTestFiles = [
  'tests/tier1-features.spec.js',
  'tests/tier2-boundary.spec.js',
  'tests/tier3-crossfeature.spec.js',
  'tests/tier4-multiclientsync.spec.js'
];

try {
  const readmeContent = fs.readFileSync(README_PATH, 'utf8');
  expectedTestFiles.forEach(relPath => {
    // Check mentioned in README
    const isMentioned = readmeContent.includes(relPath) || readmeContent.includes(path.basename(relPath));
    assert.strictEqual(isMentioned, true, `${relPath} must be mentioned in README.md`);
    
    // Check disk existence
    const fullPath = path.join(__dirname, '..', relPath);
    const exists = fs.existsSync(fullPath);
    assert.strictEqual(exists, true, `${relPath} must exist on disk at ${fullPath}`);
    recordTest(`Test file ${relPath} listed in README.md exists on disk`, true);
  });
} catch (e) {
  recordTest('README test files verification', false, e.message);
}

// -------------------------------------------------------------
// SUMMARY & VERDICT
// -------------------------------------------------------------
console.log('\n=== Empirical Challenge Summary ===');
console.log(`Total Checks: ${totalTests}`);
console.log(`Passed: ${passedTests}`);
console.log(`Failed: ${failedTests}`);

if (failedTests > 0) {
  console.log('\nVERDICT: REQUEST_CHANGES');
  process.exit(1);
} else {
  console.log('\nVERDICT: APPROVE');
  process.exit(0);
}
