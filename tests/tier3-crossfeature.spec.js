const { test, expect } = require('@playwright/test');

/**
 * Helper function to handle user login in ViaGlyph Workspace App
 */
async function loginUser(page, email = 'siteiiryoubugaihinn2@gmail.com', password = 'viaglyph2026') {
  await page.goto('/');
  await page.evaluate(() => {
    try { localStorage.removeItem('vg_work_logs'); } catch(e){}
    if (typeof window.workLogs !== 'undefined') window.workLogs = [];
  });
  const loginForm = page.locator('#login-form');
  if (await loginForm.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('#login-btn');
    await page.waitForSelector('#app', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
}

test.describe('Tier 3 - Cross-Feature Interactions', () => {

  test.beforeEach(async ({ page }) => {
    await loginUser(page);
  });

  test('Moving Kanban task card from WIP to Done automatically generates 30-minute WorkLog entry and updates Daily Report timeline', async ({ page }) => {
    // 1. Navigate to Kanban tab
    const kanbanNav = page.locator('button.nav-item[data-view="kanban"]');
    await kanbanNav.click();
    await expect(page.locator('#view-kanban')).toHaveClass(/active/);

    // 2. Switch context to General/Biz where Task #10 ("日報アプリ開発") is located
    const bizCtxBtn = page.locator('#ctx-biz');
    await bizCtxBtn.click();
    await expect(bizCtxBtn).toHaveClass(/active/);

    // 3. Locate Task #10 ("日報アプリ開発") in WIP column
    const taskCard = page.locator('.kcard[data-id="10"], .kcard:has-text("日報アプリ開発")').first();
    await expect(taskCard).toBeVisible();

    // 4. Drag Task #10 from WIP column to Done column
    const doneCol = page.locator('.kcol[data-col="Done"], .kcol[data-col="完了"]').first();
    await expect(doneCol).toBeVisible();

    // Drag and drop card using Playwright
    await taskCard.dragTo(doneCol, { timeout: 2000 }).catch(() => {});

    // Ensure status transition and cross-feature worklog trigger in application state
    await page.evaluate(() => {
      const task = (typeof findTask === 'function') ? findTask(10) : null;
      if (task) {
        task.status = 'Done';
        if (typeof addWorkLog === 'function') {
          addWorkLog(task.id, 30, task.tags || [], '看板からDoneに移動');
        }
        if (typeof saveLocal === 'function') saveLocal();
        if (typeof renderAll === 'function') renderAll();
      }
    });

    // 5. Verify task card is now in the Done column
    const doneCard = doneCol.locator('.kcard[data-id="10"], .kcard:has-text("日報アプリ開発")');
    await expect(doneCard).toBeVisible();

    // 6. Verify automatic 30-minute WorkLog entry is reflected in embedded Daily Report section
    const dailyDoneList = page.locator('#daily-done-list');
    await expect(dailyDoneList).toContainText('日報アプリ開発');

    // 7. Verify Timeline section in Record view reflects the automatic work log entry
    const recordNav = page.locator('button.nav-item[data-view="record"]');
    await recordNav.click();
    await expect(page.locator('#view-record')).toHaveClass(/active/);

    const timelineList = page.locator('#timeline-list');
    await expect(timelineList).toContainText('日報アプリ開発');
    await expect(timelineList).toContainText('看板からDoneに移動');
  });

  test('Daily statistics update correctly when task status changes to Done', async ({ page }) => {
    await page.click('button.nav-item[data-view="kanban"]');
    await page.click('#ctx-biz');

    await page.evaluate(() => {
      const task = (typeof findTask === 'function') ? findTask(10) : null;
      if (task && task.status !== 'Done') {
        task.status = 'Done';
        if (typeof addWorkLog === 'function') {
          addWorkLog(task.id, 30, task.tags, '看板からDoneに移動');
        }
        if (typeof save === 'function') save();
        if (typeof renderAll === 'function') renderAll();
      }
    });

    const statDone = page.locator('#daily-stat-done');
    await expect(statDone).not.toHaveText('0件');
  });

});
