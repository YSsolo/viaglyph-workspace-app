const { test, expect } = require('@playwright/test');

test.describe('Challenger 2 Milestone 1 Empirical Verification Suite', () => {

  test.beforeEach(async ({ page }) => {
    await page.route('**/macros/s/**', route => route.abort());
    await page.goto('/');
    // Login
    await page.fill('#login-email', 'siteiiryoubugaihinn2@gmail.com');
    await page.fill('#login-password', 'viaglyph2026');
    await page.click('#login-btn');
    await expect(page.locator('#app')).toBeVisible();
    await page.waitForTimeout(100);
    await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });

    // Navigate to Goals view
    await page.click('.nav-item[data-view="goals"]');
    await expect(page.locator('#view-goals')).toHaveClass(/active/);
  });

  test('E1: Task Checkbox State Updates & Accordion Non-Interference', async ({ page }) => {
    // Locate first task check box in goals tree
    const firstCheck = page.locator('#goals-tree .goal-task-check').first();
    const firstTaskItem = page.locator('#goals-tree .goal-task-item').first();
    const parentMid = firstTaskItem.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " goal-mid ")]');
    const parentBig = firstTaskItem.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " goal-big ")]');
    const parentProject = firstTaskItem.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " goal-project ")]');

    // Confirm initial accordion state is open
    await expect(parentMid).toHaveClass(/open/);
    await expect(parentBig).toHaveClass(/open/);
    await expect(parentProject).toHaveClass(/open/);

    const initialIsDone = await firstCheck.evaluate(el => el.classList.contains('done'));

    // Perform Checkbox Toggle Click
    await firstCheck.click();

    // Verify DOM state updated
    if (initialIsDone) {
      await expect(firstCheck).not.toHaveClass(/done/);
    } else {
      await expect(firstCheck).toHaveClass(/done/);
    }

    // Verify Parent Accordions remained open (event.stopPropagation worked)
    await expect(parentMid).toHaveClass(/open/);
    await expect(parentBig).toHaveClass(/open/);
    await expect(parentProject).toHaveClass(/open/);

    // Verify In-Memory State & LocalStorage State
    const stateMatch = await page.evaluate((wasDone) => {
      const goalsArr = window.goals;
      if (!Array.isArray(goalsArr) || goalsArr.length === 0) return false;
      const t = goalsArr[0]?.bigGoals?.[0]?.midGoals?.[0]?.tasks?.[0];
      if (!t) return false;
      const lsGoals = JSON.parse(localStorage.getItem('vg_goals') || '[]');
      const lsTask = lsGoals[0]?.bigGoals?.[0]?.midGoals?.[0]?.tasks?.[0];
      return (t.done === !wasDone) && (lsTask.done === !wasDone);
    }, initialIsDone);

    expect(stateMatch).toBe(true);

    // Toggle back to restore original state
    await firstCheck.click();
    const restoredIsDone = await firstCheck.evaluate(el => el.classList.contains('done'));
    expect(restoredIsDone).toBe(initialIsDone);
  });

  test('E2: Task Checkbox Completion Metrics & Dynamic Progress Calculation', async ({ page }) => {
    // Select first project container
    const projectElem = page.locator('#goals-tree .goal-project').first();
    const countDisplay = projectElem.locator('.goal-project-count');
    const progressFill = projectElem.locator('.goal-progress-fill');

    const initialCountText = await countDisplay.innerText(); // e.g. "1/5"
    const [initialDoneStr, totalStr] = initialCountText.split('/');
    const initialDone = parseInt(initialDoneStr, 10);
    const total = parseInt(totalStr, 10);

    const initialFillWidth = await progressFill.evaluate(el => el.style.width);

    // Find a task check within this project that is not done
    const checks = projectElem.locator('.goal-task-check');
    const count = await checks.count();
    let targetIndex = -1;
    for (let i = 0; i < count; i++) {
      const isDone = await checks.nth(i).evaluate(el => el.classList.contains('done'));
      if (!isDone) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1) {
      // Toggle task to done
      await checks.nth(targetIndex).click();

      // Verify updated project count display
      const updatedCountText = await countDisplay.innerText();
      const [updatedDoneStr] = updatedCountText.split('/');
      const updatedDone = parseInt(updatedDoneStr, 10);

      expect(updatedDone).toBe(initialDone + 1);

      // Verify progress fill percentage calculation
      const expectedPct = Math.round(((initialDone + 1) / total) * 100);
      const updatedFillWidth = await progressFill.evaluate(el => el.style.width);
      expect(updatedFillWidth).toBe(`${expectedPct}%`);

      // Revert check
      await checks.nth(targetIndex).click();
      const revertedCountText = await countDisplay.innerText();
      expect(revertedCountText).toBe(initialCountText);
    }
  });

  test('E3: Firebase RTDB Payload Integrity Validation', async ({ page }) => {
    const payloadIntegrity = await page.evaluate(() => {
      const g = window.goals;
      if (!Array.isArray(g)) return { valid: false, reason: 'goals is not an array' };

      for (let pIdx = 0; pIdx < g.length; pIdx++) {
        const proj = g[pIdx];
        if (!proj.id || !proj.name) return { valid: false, reason: `Project at ${pIdx} missing id/name` };
        if (!Array.isArray(proj.bigGoals)) return { valid: false, reason: `Project ${proj.id} bigGoals is not array` };

        for (let bIdx = 0; bIdx < proj.bigGoals.length; bIdx++) {
          const bg = proj.bigGoals[bIdx];
          if (!bg.id || !bg.name) return { valid: false, reason: `BigGoal at ${pIdx}.${bIdx} missing id/name` };
          if (!Array.isArray(bg.midGoals)) return { valid: false, reason: `BigGoal ${bg.id} midGoals is not array` };

          for (let mIdx = 0; mIdx < bg.midGoals.length; mIdx++) {
            const mg = bg.midGoals[mIdx];
            if (!mg.id || !mg.name) return { valid: false, reason: `MidGoal at ${pIdx}.${bIdx}.${mIdx} missing id/name` };
            if (!Array.isArray(mg.tasks)) return { valid: false, reason: `MidGoal ${mg.id} tasks is not array` };

            for (let tIdx = 0; tIdx < mg.tasks.length; tIdx++) {
              const task = mg.tasks[tIdx];
              if (!task.id || !task.name) return { valid: false, reason: `Task at ${pIdx}.${bIdx}.${mIdx}.${tIdx} missing id/name` };
              if (typeof task.done !== 'boolean') return { valid: false, reason: `Task ${task.id} done property is not boolean` };
            }
          }
        }
      }

      // Check normalizeGoals function output consistency
      if (typeof normalizeGoals === 'function') {
        const normalized = normalizeGoals(g);
        if (!Array.isArray(normalized) || normalized.length !== g.length) {
          return { valid: false, reason: 'normalizeGoals mutated or distorted array size' };
        }
      }

      return { valid: true };
    });

    expect(payloadIntegrity.valid).toBe(true);
  });

  test('E4: Stress & Rapid Toggling Robustness Test', async ({ page }) => {
    const firstCheck = page.locator('#goals-tree .goal-task-check').first();

    // Perform 10 rapid clicks
    for (let i = 0; i < 10; i++) {
      await firstCheck.click();
    }

    // Verify DOM and memory state consistency after rapid toggles (even number of toggles => same initial state)
    const stateConsistent = await page.evaluate(() => {
      const g = window.goals;
      const firstTask = g[0]?.bigGoals?.[0]?.midGoals?.[0]?.tasks?.[0];
      const lsGoals = JSON.parse(localStorage.getItem('vg_goals') || '[]');
      const lsFirstTask = lsGoals[0]?.bigGoals?.[0]?.midGoals?.[0]?.tasks?.[0];
      return firstTask.done === lsFirstTask.done;
    });

    expect(stateConsistent).toBe(true);
  });

});
