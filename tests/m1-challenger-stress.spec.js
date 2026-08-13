const { test, expect } = require('@playwright/test');

test.describe('Milestone 1 Empirical Challenger Suite - Goals Tab Tree UI', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept network calls to ensure fast execution
    await page.route('**/macros/s/**', route => route.abort());
    await page.goto('/');

    // Perform login
    await page.fill('#login-email', 'siteiiryoubugaihinn2@gmail.com');
    await page.fill('#login-password', 'viaglyph2026');
    await page.click('#login-btn');
    await expect(page.locator('#app')).toBeVisible();

    // Navigate to Goals tab
    await page.click('.nav-item[data-view="goals"]');
    await expect(page.locator('#view-goals')).toHaveClass(/active/);
  });

  test('1.1 Verify strict 4-level DOM tree nesting in #goals-tree', async ({ page }) => {
    const goalsTree = page.locator('#goals-tree');
    await expect(goalsTree).toBeVisible();

    // Level 1: Project
    const projects = goalsTree.locator('> .goal-project');
    const projectCount = await projects.count();
    expect(projectCount).toBeGreaterThan(0);

    for (let i = 0; i < projectCount; i++) {
      const proj = projects.nth(i);
      await expect(proj.locator('> .goal-project-header')).toBeVisible();
      const projBody = proj.locator('> .goal-project-body');
      await expect(projBody).toBeVisible();

      // Level 2: Big Goal inside Project Body
      const bigs = projBody.locator('> .goal-big');
      const bigCount = await bigs.count();
      for (let j = 0; j < bigCount; j++) {
        const bg = bigs.nth(j);
        await expect(bg.locator('> .goal-big-header')).toBeVisible();
        const bgBody = bg.locator('> .goal-big-body');
        await expect(bgBody).toBeVisible();

        // Level 3: Mid Goal inside Big Goal Body
        const mids = bgBody.locator('> .goal-mid');
        const midCount = await mids.count();
        for (let k = 0; k < midCount; k++) {
          const mg = mids.nth(k);
          await expect(mg.locator('> .goal-mid-header')).toBeVisible();
          const mgBody = mg.locator('> .goal-mid-body');
          await expect(mgBody).toBeVisible();

          // Level 4: Task Items inside Mid Goal Body
          const tasks = mgBody.locator('> .goal-task-item');
          const taskCount = await tasks.count();
          for (let l = 0; l < taskCount; l++) {
            const t = tasks.nth(l);
            await expect(t.locator('.goal-task-check')).toBeAttached();
            await expect(t.locator('.goal-task-name')).toBeAttached();
            await expect(t.locator('.goal-task-assign')).toBeAttached();
          }
        }
      }
    }
  });

  test('1.2 Verify interactive expand/collapse toggle for Level 1 (Project)', async ({ page }) => {
    const proj = page.locator('#goals-tree > .goal-project').first();
    const projHeader = proj.locator('> .goal-project-header');

    await expect(proj).toHaveClass(/open/);
    await projHeader.click();
    await expect(proj).not.toHaveClass(/open/);
    await projHeader.click();
    await expect(proj).toHaveClass(/open/);
  });

  test('1.3 Verify interactive expand/collapse toggle for Level 2 (BigGoal)', async ({ page }) => {
    const proj = page.locator('#goals-tree > .goal-project').first();
    const bg = proj.locator('> .goal-project-body > .goal-big').first();
    const bgHeader = bg.locator('> .goal-big-header');

    await expect(bg).toHaveClass(/open/);
    await bgHeader.click();
    await expect(bg).not.toHaveClass(/open/);
    await bgHeader.click();
    await expect(bg).toHaveClass(/open/);
  });

  test('1.4 Verify interactive expand/collapse toggle for Level 3 (MidGoal)', async ({ page }) => {
    const proj = page.locator('#goals-tree > .goal-project').first();
    const bg = proj.locator('> .goal-project-body > .goal-big').first();
    const mg = bg.locator('> .goal-big-body > .goal-mid').first();
    const mgHeader = mg.locator('> .goal-mid-header');

    await expect(mg).toHaveClass(/open/);
    await mgHeader.scrollIntoViewIfNeeded();
    await mgHeader.click({ force: true });
    await expect(mg).not.toHaveClass(/open/);
    await mgHeader.click({ force: true });
    await expect(mg).toHaveClass(/open/);
  });

  test('1.5 Edge Case: Rapid toggling of project accordion header', async ({ page }) => {
    const proj = page.locator('#goals-tree > .goal-project').first();
    const projHeader = proj.locator('> .goal-project-header');

    // 10 clicks with short wait between clicks to allow DOM updates
    for (let i = 0; i < 10; i++) {
      await projHeader.click();
      await page.waitForTimeout(50);
    }

    // 10 clicks (even number) from initially 'open' -> should end up back 'open'
    await expect(proj).toHaveClass(/open/);

    // 1 more click -> should be closed (not open)
    await projHeader.click();
    await expect(proj).not.toHaveClass(/open/);
  });

  test('1.6 Edge Case: Stop propagation on Checkbox and Add buttons', async ({ page }) => {
    const proj = page.locator('#goals-tree > .goal-project').first();
    const bg = proj.locator('> .goal-project-body > .goal-big').first();
    const mg = bg.locator('> .goal-big-body > .goal-mid').first();
    const taskCheck = mg.locator('> .goal-mid-body > .goal-task-item .goal-task-check').first();

    // Ensure parents are open
    await expect(proj).toHaveClass(/open/);
    await expect(bg).toHaveClass(/open/);
    await expect(mg).toHaveClass(/open/);

    // Click task checkbox
    await taskCheck.click();

    // Checkbox click MUST NOT trigger accordion toggle on mg, bg, or proj
    await expect(mg).toHaveClass(/open/);
    await expect(bg).toHaveClass(/open/);
    await expect(proj).toHaveClass(/open/);

    // Click "＋ タスク追加" button
    const addTaskBtn = mg.locator('> .goal-mid-body > .goal-add-btn').first();
    await addTaskBtn.click();

    // Should NOT trigger accordion toggle
    await expect(mg).toHaveClass(/open/);
    await expect(bg).toHaveClass(/open/);
    await expect(proj).toHaveClass(/open/);
  });

  test('1.7 Edge Case: Empty goal data rendering resilience', async ({ page }) => {
    // Inject single empty project (no bigGoals)
    await page.evaluate(() => {
      window.goals = [{
        id: 999,
        name: 'Empty Project Test',
        icon: '🧪',
        status: 'active',
        bigGoals: []
      }];
      renderGoals();
    });

    const goalsTree = page.locator('#goals-tree');
    const proj = goalsTree.locator('> .goal-project').first();
    await expect(proj).toBeVisible();
    await expect(proj.locator('.goal-project-name')).toHaveText('Empty Project Test');
    await expect(proj.locator('.goal-project-count')).toHaveText('0/0');
    expect(await proj.locator('.goal-big').count()).toBe(0);
  });
});
