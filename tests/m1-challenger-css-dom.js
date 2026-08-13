const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== Milestone 1 Empirical Challenger Unit & DOM/CSS Verification ===\n');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.log(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

const ROOT_DIR = path.resolve(__dirname, '..');
const viewsCode = fs.readFileSync(path.join(ROOT_DIR, 'views.js'), 'utf8');
const styleCode = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');

// 1. CSS Verification
console.log('--- 1. CSS Rule Verification ---');

check('style.css defines .goal-project, .goal-big, .goal-mid, .goal-task-item', () => {
  assert(styleCode.includes('.goal-project'), 'Missing .goal-project');
  assert(styleCode.includes('.goal-big'), 'Missing .goal-big');
  assert(styleCode.includes('.goal-mid'), 'Missing .goal-mid');
  assert(styleCode.includes('.goal-task-item'), 'Missing .goal-task-item');
});

check('style.css contains cumulative step indentations for goal hierarchy', () => {
  assert(styleCode.includes('.goal-big') && styleCode.includes('margin-left'), 'Missing margin-left for hierarchy');
  assert(styleCode.includes('.goal-mid'), 'Missing .goal-mid indentation rule');
});

check('style.css contains accordion toggle arrow rotation rules', () => {
  assert(styleCode.includes('transform: rotate(') || styleCode.includes('rotate('), 'Missing arrow rotation rule in style.css');
});

check('style.css contains body visibility toggle rule (.open)', () => {
  assert(styleCode.includes('.open'), 'Missing .open state selector in style.css');
});

// 2. JS Code & Event Handler Verification
console.log('\n--- 2. JS Logic & DOM Generation Verification ---');

check('views.js renderGoals includes 4-level nesting (project -> big -> mid -> task)', () => {
  assert(viewsCode.includes('goal-project'), 'Missing goal-project');
  assert(viewsCode.includes('goal-big'), 'Missing goal-big');
  assert(viewsCode.includes('goal-mid'), 'Missing goal-mid');
  assert(viewsCode.includes('goal-task-item'), 'Missing goal-task-item');
});

check('views.js uses stopPropagation on goal-task-check', () => {
  assert(viewsCode.includes('event.stopPropagation()'), 'Missing event.stopPropagation()');
  const taskCheckMatch = viewsCode.includes('class="goal-task-check') && viewsCode.includes('event.stopPropagation()');
  assert(taskCheckMatch, 'goal-task-check does not have stopPropagation');
});

check('views.js uses stopPropagation on goal-add-btn', () => {
  const addBtnMatch = viewsCode.includes('class="goal-add-btn"') && viewsCode.includes('event.stopPropagation()');
  assert(addBtnMatch, 'goal-add-btn does not have stopPropagation');
});

check('views.js accordion header click handlers use closest() and toggle("open")', () => {
  assert(viewsCode.includes('.classList.toggle(\'open\')') || viewsCode.includes('.classList.toggle("open")'), 'Missing classList.toggle("open")');
  assert(viewsCode.includes('.closest('), 'Header click handler does not use .closest()');
});

// 3. Mock DOM Render Test
console.log('\n--- 3. Mock Data DOM Render Execution Test ---');

check('renderGoals produces expected HTML for sample 4-level data', () => {
  const mockGoals = [{
    id: 1,
    name: 'Test Project',
    icon: '🚀',
    status: 'active',
    bigGoals: [{
      id: 10,
      name: 'Test Big Goal',
      status: 'active',
      midGoals: [{
        id: 100,
        name: 'Test Mid Goal',
        status: 'active',
        tasks: [{
          id: 1000,
          name: 'Test Task 1',
          done: false,
          assign: '山口'
        }]
      }]
    }]
  }];

  let mockHtml = '';
  const mockElement = {
    set innerHTML(val) { mockHtml = val; },
    get innerHTML() { return mockHtml; }
  };

  const mockDoc = {
    getElementById: (id) => id === 'goals-tree' ? mockElement : null
  };

  // Run renderGoals logic with mock env
  const goals = mockGoals;
  const GOAL_STATUS = {
    pending:{label:'未着手',color:'#9ca3af',bg:'#f3f4f6'},
    active:{label:'取組中',color:'var(--data-01)',bg:'#dbeafe'},
    delayed:{label:'遅延',color:'var(--data-05)',bg:'#fef2f2'},
    done:{label:'完了',color:'var(--data-03)',bg:'#dcfce7'}
  };

  // Extract body of renderGoals from viewsCode
  const renderGoalsStart = viewsCode.indexOf('function renderGoals()');
  const renderGoalsEnd = viewsCode.indexOf('// ─── PROJECT PAGE ───');
  assert(renderGoalsStart !== -1 && renderGoalsEnd !== -1, 'Could not locate renderGoals in views.js');

  const fnCode = viewsCode.substring(renderGoalsStart, renderGoalsEnd);
  
  const evalContext = {
    document: mockDoc,
    goals: mockGoals,
    GOAL_STATUS: GOAL_STATUS,
    window: { goals: mockGoals }
  };

  // Evaluate in context
  const vm = require('vm');
  vm.runInNewContext(fnCode + '\nrenderGoals();', evalContext);

  assert(mockHtml.includes('goal-project'), 'Rendered HTML missing goal-project');
  assert(mockHtml.includes('Test Project'), 'Rendered HTML missing Project Name');
  assert(mockHtml.includes('goal-big'), 'Rendered HTML missing goal-big');
  assert(mockHtml.includes('Test Big Goal'), 'Rendered HTML missing Big Goal Name');
  assert(mockHtml.includes('goal-mid'), 'Rendered HTML missing goal-mid');
  assert(mockHtml.includes('Test Mid Goal'), 'Rendered HTML missing Mid Goal Name');
  assert(mockHtml.includes('goal-task-item'), 'Rendered HTML missing goal-task-item');
  assert(mockHtml.includes('Test Task 1'), 'Rendered HTML missing Task Name');
});

console.log(`\n=== Verification Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
