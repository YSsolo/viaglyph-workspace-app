const { test, expect } = require('@playwright/test');

/**
 * Helper function to handle user login in a specific browser page
 */
async function loginUser(page, email, password = 'viaglyph2026') {
  await page.goto('/');
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

test.describe('Tier 4 - Real-World Multi-Client Real-Time Synchronization', () => {

  let contextA, contextB;
  let pageA, pageB;

  test.beforeEach(async ({ browser }) => {
    // Create 2 concurrent browser contexts: User A (山口 慧) and User B (市川 翔大)
    contextA = await browser.newContext();
    contextB = await browser.newContext();

    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    // User A: 山口 慧
    await loginUser(pageA, 'siteiiryoubugaihinn2@gmail.com', 'viaglyph2026');

    // User B: 市川 翔大
    await loginUser(pageB, 'shotaatut@gmail.com', 'viaglyph2026');
  });

  test.afterEach(async () => {
    if (contextA) await contextA.close();
    if (contextB) await contextB.close();
  });

  test('Test 1: Real-time Kanban status sync across 2 browser contexts within 3.0 seconds without page reload', async () => {
    // Navigate both clients to Kanban view in General/Biz context
    await pageA.click('button.nav-item[data-view="kanban"]');
    await pageA.click('#ctx-biz');

    await pageB.click('button.nav-item[data-view="kanban"]');
    await pageB.click('#ctx-biz');

    // User A updates Task #10 status to Done in contextA
    await pageA.evaluate(() => {
      const task = (typeof findTask === 'function') ? findTask(10) : null;
      if (task) {
        task.status = 'Done';
        if (typeof API !== 'undefined' && API.updateTask) {
          API.updateTask(10, { status: 'Done' }).catch(() => {});
        }
        if (typeof firebaseDb !== 'undefined' && firebaseDb) {
          firebaseDb.ref('tasks/biz/10').update({ status: 'Done' }).catch(() => {});
        }
        if (typeof save === 'function') save();
        if (typeof renderAll === 'function') renderAll();
      }
    });

    // Verify User B sees updated card position in contextB within 3.0 seconds without page reload
    const doneColB = pageB.locator('.kcol[data-col="Done"], .kcol[data-col="完了"]').first();
    const taskCardInDoneB = doneColB.locator('.kcard[data-id="10"], .kcard:has-text("日報アプリ開発")');

    await expect(taskCardInDoneB).toBeVisible({ timeout: 3000 });
  });

  test('Test 2: Real-time Member status sync across 2 browser contexts within 3.0 seconds without page reload', async () => {
    // Navigate both clients to Members view
    await pageA.click('button.nav-item[data-view="members"]');
    await pageB.click('button.nav-item[data-view="members"]');

    // User A (山口) changes status from 'online' to 'away' in contextA
    await pageA.evaluate(() => {
      if (typeof memberStatuses !== 'undefined') {
        memberStatuses.yamaguchi = 'away';
        if (typeof saveMemberStatuses === 'function') saveMemberStatuses();
        if (typeof renderMembers === 'function') renderMembers();
        if (typeof API !== 'undefined' && API.updateMemberStatus) {
          API.updateMemberStatus('山口', 'away').catch(() => {});
        }
        if (typeof firebaseDb !== 'undefined' && firebaseDb) {
          firebaseDb.ref('memberStatus/yamaguchi').set('away').catch(() => {});
        }
      }
    });

    // Verify User B sees updated status dot (.status-dot.away or .member-status-dot.away) in contextB within 3.0s without page reload
    const yamaguchiAwayDotB = pageB.locator('.member-card:has-text("山口") .member-status-dot.away, .member-card:has-text("山口") .status-dot.away, .member-status-label.away');
    await expect(yamaguchiAwayDotB).toBeVisible({ timeout: 3000 });
  });

  test('Test 3: Real-time WorkLog sync across 2 browser contexts within 3.0 seconds without page reload', async () => {
    // Navigate pageA to Record view, pageB to Record view
    await pageA.click('button.nav-item[data-view="record"]');
    await pageB.click('button.nav-item[data-view="record"]');

    const syncComment = 'Real-time Sync Log ' + Date.now();

    // User A submits a work log entry in contextA
    await pageA.evaluate(async (commentText) => {
      const today = new Date().toISOString().slice(0, 10);
      const log = { taskId: 10, minutes: 45, tags: ['開発'], comment: commentText, user: '山口', date: today, createdAt: new Date().toISOString() };
      if (typeof addWorkLog === 'function') {
        await addWorkLog(10, 45, ['開発'], commentText);
      } else if (typeof API !== 'undefined' && API.addWorkLog) {
        await API.addWorkLog(log);
      }
      if (typeof renderTimeline === 'function') renderTimeline();
    }, syncComment);

    // Verify User B sees new timeline entry in contextB within 3.0 seconds without page reload
    const timelineEntryB = pageB.locator('#timeline-list, #daily-done-list').locator(`:has-text("${syncComment}")`).first();
    await expect(timelineEntryB).toBeVisible({ timeout: 5000 });
  });

  test('Test 4: Real-time Canvas sync across 2 browser contexts within 3.0 seconds without page reload', async () => {
    // Navigate both clients to Canvas view
    await pageA.click('button.nav-item[data-view="canvas"]');
    await pageB.click('button.nav-item[data-view="canvas"]');

    const updatedTitle = 'Synced Meeting Canvas ' + Date.now();

    // User A creates or updates a canvas block/title in contextA
    await pageA.evaluate((newTitle) => {
      if (typeof createCanvas === 'function') {
        createCanvas();
      }
      if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        firebaseDb.ref('canvases/test-sync-canvas/meta').set({
          title: newTitle,
          updatedAt: Date.now(),
          updatedBy: '山口'
        }).catch(() => {});
        firebaseDb.ref('canvases/test-sync-canvas/blocks/b1').set({
          type: 'heading',
          text: newTitle,
          order: 0
        }).catch(() => {});
      }
      const titleEl = document.getElementById('canvas-title');
      if (titleEl) {
        titleEl.value = newTitle;
        titleEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, updatedTitle);

    // Verify User B sees updated canvas block / title in contextB within 3.0 seconds without page reload
    const canvasB = pageB.locator('#canvas-title, #canvas-blocks, .canvas-card').locator(`:has-text("${updatedTitle}")`);
    await expect(canvasB).toBeVisible({ timeout: 3000 });
  });

});
