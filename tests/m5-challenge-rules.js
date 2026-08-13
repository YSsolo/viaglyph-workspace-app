/**
 * Empirical Challenge Test Script for Milestone 5
 * Validates database.rules.json task schema validation rules.
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
    if (!this._val || typeof this._val !== 'object' || Array.isArray(this._val)) return false;
    if (!keys) return Object.keys(this._val).length > 0;
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

const taskNodeRules = rulesJson.rules.tasks.$ctx.$task_id;

function evaluateTaskRule(taskObj, ctx = 'dev') {
  // Context check
  const ctxRule = rulesJson.rules.tasks.$ctx['.validate'];
  const ctxValid = ctx === 'dev' || ctx === 'biz';
  if (!ctxValid) return false;

  // Root task validate
  const taskSnap = new RuleDataSnapshot(taskObj);
  const taskRootExpr = taskNodeRules['.validate'];
  
  const rootFn = new Function('newData', `$ctx`, `return ${taskRootExpr};`);
  if (!rootFn(taskSnap, ctx)) {
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

// Baseline valid task
const baseValidTask = {
  id: 'task-101',
  title: 'Test Task Title',
  status: 'TODO',
  prio: '高',
  assign: '山口',
  ctx: 'dev'
};

// Test Case 1: Task WITH due (string)
try {
  const taskWithDue = { ...baseValidTask, due: '2026-08-31' };
  const isValid = evaluateTaskRule(taskWithDue);
  assert.strictEqual(isValid, true, 'Task WITH valid due string must pass validation');
  recordTest('Task WITH due (string) passes validation', true);
} catch (e) {
  recordTest('Task WITH due (string) passes validation', false, e.message);
}

// Test Case 2: Task WITHOUT due
try {
  const taskWithoutDue = { ...baseValidTask }; // due omitted
  const isValid = evaluateTaskRule(taskWithoutDue);
  assert.strictEqual(isValid, true, 'Task WITHOUT due must pass validation');
  recordTest('Task WITHOUT due passes validation', true);
} catch (e) {
  recordTest('Task WITHOUT due passes validation', false, e.message);
}

// Test Case 3: Task with INVALID due type (number)
try {
  const taskWithInvalidDueNum = { ...baseValidTask, due: 1700000000 };
  const isValid = evaluateTaskRule(taskWithInvalidDueNum);
  assert.strictEqual(isValid, false, 'Task with due as number must fail validation');
  recordTest('Task with invalid due type (number) fails validation', true);
} catch (e) {
  recordTest('Task with invalid due type (number) fails validation', false, e.message);
}

// Test Case 4: Task with INVALID due type (boolean)
try {
  const taskWithInvalidDueBool = { ...baseValidTask, due: true };
  const isValid = evaluateTaskRule(taskWithInvalidDueBool);
  assert.strictEqual(isValid, false, 'Task with due as boolean must fail validation');
  recordTest('Task with invalid due type (boolean) fails validation', true);
} catch (e) {
  recordTest('Task with invalid due type (boolean) fails validation', false, e.message);
}

// Test Case 5: Task with INVALID status
const invalidStatuses = ['INVALID_STATUS', 'In Progress', 123, null];
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

// Test Case 6: Task with ALL VALID statuses (TODO, WIP, Review, Blocked, Done)
const validStatuses = ['TODO', 'WIP', 'Review', 'Blocked', 'Done'];
validStatuses.forEach(valStatus => {
  try {
    const taskWithValidStatus = { ...baseValidTask, status: valStatus };
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
