const { test, expect } = require('@playwright/test');

test.describe('Goals Tab 4-Level Tree UI E2E Tests', () => {

  async function loginAndNavigateToGoals(page) {
    // Intercept external GAS calls to prevent network wait timeout
    await page.route('**/macros/s/**', route => route.abort());
    await page.goto('/');

    // Perform login with valid user credentials
    await page.fill('#login-email', 'siteiiryoubugaihinn2@gmail.com');
    await page.fill('#login-password', 'viaglyph2026');
    await page.click('#login-btn');

    // Wait for main application view to load
    await expect(page.locator('#app')).toBeVisible();

    // Navigate to Goals tab
    await page.click('.nav-item[data-view="goals"]');
    await expect(page.locator('#view-goals')).toBeVisible();
    await expect(page.locator('#goals-tree')).toBeVisible();

    // Wait for goals tree element to render and stabilize after any initial Firebase sync
    await page.waitForSelector('#goals-tree > .goal-project');
    await page.waitForTimeout(1000);
  }

  test.beforeEach(async ({ page }) => {
    await loginAndNavigateToGoals(page);
  });

  test('Test 1: Verify 4-level HTML DOM tree nesting (Project > Big Goal > Mid Goal > Task)', async ({ page }) => {
    // Verify Level 1: Project element and project body exist
    const projectElement = page.locator('#goals-tree > .goal-project').first();
    await expect(projectElement).toBeVisible();

    const projectBody = projectElement.locator('> .goal-project-body');
    await expect(projectBody).toBeVisible();

    // Verify Level 2: Big Goal element inside Project Body
    const bigGoalElement = projectBody.locator('> .goal-big').first();
    await expect(bigGoalElement).toBeVisible();

    const bigGoalBody = bigGoalElement.locator('> .goal-big-body');
    await expect(bigGoalBody).toBeVisible();

    // Verify Level 3: Mid Goal element inside Big Goal Body
    const midGoalElement = bigGoalBody.locator('> .goal-mid').first();
    await expect(midGoalElement).toBeVisible();

    const midGoalBody = midGoalElement.locator('> .goal-mid-body');
    await expect(midGoalBody).toBeVisible();

    // Verify Level 4: Task item element inside Mid Goal Body
    const taskItem = midGoalBody.locator('> .goal-task-item').first();
    await expect(taskItem).toBeVisible();

    // Verify strict 4-level CSS selector nesting path
    const fullNestedSelector = page.locator('.goal-project > .goal-project-body > .goal-big > .goal-big-body > .goal-mid > .goal-mid-body > .goal-task-item');
    const count = await fullNestedSelector.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Test 2: Verify interactive expand/collapse toggle functionality for Level 1, Level 2, and Level 3', async ({ page }) => {
    // Level 1: Project header toggle
    const project = page.locator('#goals-tree > .goal-project').first();
    const projectHeader = project.locator('> .goal-project-header');

    await expect(project).toHaveClass(/open/);
    await projectHeader.click();
    await expect(project).not.toHaveClass(/open/);
    await projectHeader.click();
    await expect(project).toHaveClass(/open/);

    // Level 2: Big Goal header toggle
    const bigGoal = project.locator('> .goal-project-body > .goal-big').first();
    const bigGoalHeader = bigGoal.locator('> .goal-big-header');

    await expect(bigGoal).toHaveClass(/open/);
    await bigGoalHeader.click();
    await expect(bigGoal).not.toHaveClass(/open/);
    await bigGoalHeader.click();
    await expect(bigGoal).toHaveClass(/open/);

    // Level 3: Mid Goal header toggle
    const midGoal = bigGoal.locator('> .goal-big-body > .goal-mid').first();
    const midGoalHeader = midGoal.locator('> .goal-mid-header');

    await expect(midGoal).toHaveClass(/open/);
    await midGoalHeader.click();
    await expect(midGoal).not.toHaveClass(/open/);
    await midGoalHeader.click();
    await expect(midGoal).toHaveClass(/open/);
  });

  test('Test 3: Verify task completion checkbox interaction (.goal-task-check)', async ({ page }) => {
    // Target first task check in the goals tree
    const taskCheck = page.locator('#goals-tree .goal-task-check').first();
    await expect(taskCheck).toBeVisible();

    // Log initial class and check onclick handler
    const initialClass = await taskCheck.getAttribute('class');
    const initialIsDone = initialClass.includes('done');

    // Click task checkbox
    await taskCheck.click();
    await page.waitForTimeout(300);

    // Verify toggled state
    if (initialIsDone) {
      await expect(taskCheck).not.toHaveClass(/done/);
    } else {
      await expect(taskCheck).toHaveClass(/done/);
    }

    // Click task checkbox again
    await taskCheck.click();
    await page.waitForTimeout(300);

    // Verify state restored
    if (initialIsDone) {
      await expect(taskCheck).toHaveClass(/done/);
    } else {
      await expect(taskCheck).not.toHaveClass(/done/);
    }
  });

});
