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
  }
}

test.describe('Tier 5 - Adversarial Coverage Hardening: Concurrent Writes & Rapid State Toggles', () => {

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

  test('Tier 5.1: Concurrent Multi-Session Writes to Firebase RTDB Nodes (Tasks, WorkLogs, Goals, MemberStatus, DailyMemos, Canvases)', async () => {
    test.setTimeout(25000);

    const timeStamp = Date.now();

    // Context A and Context B issue concurrent burst writes across all RTDB nodes simultaneously
    const writePromises = [
      // 1. Tasks Node (dev & biz)
      pageA.evaluate(ts => {
        if (typeof API !== 'undefined' && API.addTask) {
          API.addTask({ id: `t_dev_a_${ts}`, title: `Task A ${ts}`, status: 'TODO', assign: '山口', ctx: 'dev', tags: ['dev'] });
        }
      }, timeStamp),
      pageB.evaluate(ts => {
        if (typeof API !== 'undefined' && API.addTask) {
          API.addTask({ id: `t_biz_b_${ts}`, title: `Task B ${ts}`, status: 'WIP', assign: '市川', ctx: 'biz', tags: ['biz'] });
        }
      }, timeStamp),

      // 2. WorkLogs Node
      pageA.evaluate(ts => {
        if (typeof API !== 'undefined' && API.addWorkLog) {
          API.addWorkLog({ id: `wl_a_${ts}`, taskId: 1, minutes: 25, tags: ['dev'], comment: `Concurrent Log A ${ts}`, user: '山口', date: '2026-08-11', createdAt: new Date().toISOString() });
        }
      }, timeStamp),
      pageB.evaluate(ts => {
        if (typeof API !== 'undefined' && API.addWorkLog) {
          API.addWorkLog({ id: `wl_b_${ts}`, taskId: 10, minutes: 40, tags: ['biz'], comment: `Concurrent Log B ${ts}`, user: '市川', date: '2026-08-11', createdAt: new Date().toISOString() });
        }
      }, timeStamp),

      // 3. MemberStatus Node
      pageA.evaluate(() => API.updateMemberStatus('山口', 'online')),
      pageB.evaluate(() => API.updateMemberStatus('市川', 'away')),

      // 4. DailyMemos Node
      pageA.evaluate(ts => API.saveDailyMemo('2026-08-11', '山口', `Memo update from Context A ${ts}`)),
      pageB.evaluate(ts => API.saveDailyMemo('2026-08-11', '市川', `Memo update from Context B ${ts}`)),

      // 5. Goals Node
      pageA.evaluate(() => {
        if (typeof goals !== 'undefined' && Array.isArray(goals) && goals.length > 0) {
          const cloned = JSON.parse(JSON.stringify(goals));
          cloned[0].name = 'ViaGLYPH Updated A';
          API.saveGoals(cloned);
        }
      }),

      // 6. Canvases Node
      pageA.evaluate(ts => {
        if (typeof firebaseDb !== 'undefined' && firebaseDb) {
          firebaseDb.ref('canvases/stress-canvas/meta').set({ title: `Canvas Title A ${ts}`, updatedAt: Date.now(), updatedBy: '山口' });
          firebaseDb.ref('canvases/stress-canvas/blocks/b1').set({ type: 'heading', text: `Header A ${ts}`, order: 0 });
        }
      }, timeStamp),
      pageB.evaluate(ts => {
        if (typeof firebaseDb !== 'undefined' && firebaseDb) {
          firebaseDb.ref('canvases/stress-canvas/meta').set({ title: `Canvas Title B ${ts}`, updatedAt: Date.now() + 1, updatedBy: '市川' });
          firebaseDb.ref('canvases/stress-canvas/blocks/b2').set({ type: 'text', text: `Body B ${ts}`, order: 1 });
        }
      }, timeStamp)
    ];

    await Promise.all(writePromises);

    // Verify eventual consistency within 3.0 seconds
    await pageA.waitForTimeout(1000);

    // Verify Context B sees WorkLog from Context A
    await pageB.click('button.nav-item[data-view="record"]');
    const logBLocator = pageB.locator('#timeline-list, #daily-done-list').locator(`:has-text("Concurrent Log A ${timeStamp}")`).first();
    await expect(logBLocator).toBeVisible({ timeout: 3000 });

    // Verify Context A sees WorkLog from Context B
    await pageA.click('button.nav-item[data-view="record"]');
    const logALocator = pageA.locator('#timeline-list, #daily-done-list').locator(`:has-text("Concurrent Log B ${timeStamp}")`).first();
    await expect(logALocator).toBeVisible({ timeout: 3000 });

    // Check MemberStatus eventual consistency
    await pageA.click('button.nav-item[data-view="members"]');
    await pageB.click('button.nav-item[data-view="members"]');

    const ichikawaAwayDotA = pageA.locator('.member-card:has-text("市川") .member-status-dot.away, .member-card:has-text("市川") .status-dot.away, .member-status-label.away').first();
    await expect(ichikawaAwayDotA).toBeVisible({ timeout: 3000 });

    const yamaguchiOnlineDotB = pageB.locator('.member-card:has-text("山口") .member-status-dot.online, .member-card:has-text("山口") .status-dot.online, .member-status-label.online').first();
    await expect(yamaguchiOnlineDotB).toBeVisible({ timeout: 3000 });
  });

  test('Tier 5.2: Rapid UI Member Status Toggles & Rapid Kanban State Toggles', async () => {
    test.setTimeout(25000);

    // 1. Rapid Member Status Toggles
    await pageA.click('button.nav-item[data-view="members"]');
    await pageB.click('button.nav-item[data-view="members"]');

    // Rapidly toggle Yamaguchi status 10 times in Context A
    for (let i = 0; i < 10; i++) {
      await pageA.evaluate(() => {
        if (typeof cycleMemberStatus === 'function') {
          cycleMemberStatus('yamaguchi');
        }
      });
      await pageA.waitForTimeout(50);
    }

    // Set a known final state: 'online'
    await pageA.evaluate(() => {
      if (typeof API !== 'undefined' && API.updateMemberStatus) {
        API.updateMemberStatus('山口', 'online');
      }
    });

    // Verify Context B settles to 'online' within 3.0 seconds
    const statusDotB = pageB.locator('.member-card:has-text("山口") .member-status-dot.online, .member-card:has-text("山口") .status-dot.online, .member-status-label.online').first();
    await expect(statusDotB).toBeVisible({ timeout: 3000 });

    // 2. Rapid Kanban State Toggles
    await pageA.click('button.nav-item[data-view="kanban"]');
    await pageB.click('button.nav-item[data-view="kanban"]');
    await pageA.click('#ctx-dev');
    await pageB.click('#ctx-dev');

    // Rapidly update Task #1 status across TODO -> WIP -> Review -> Done -> WIP -> Review -> Done
    const rapidStatuses = ['WIP', 'Review', 'Done', 'WIP', 'Review', 'Done'];
    for (const st of rapidStatuses) {
      await pageA.evaluate(targetStatus => {
        const task = (typeof findTask === 'function') ? findTask(1) : null;
        if (task) {
          task.status = targetStatus;
          if (typeof API !== 'undefined' && API.updateTask) {
            API.updateTask(1, { status: targetStatus }, 'dev').catch(() => {});
          }
          if (typeof save === 'function') save();
          if (typeof renderAll === 'function') renderAll();
        }
      }, st);
      await pageA.waitForTimeout(60);
    }

    // Verify final state ('Done') is reflected in Context B's Kanban within 3.0 seconds
    const doneColB = pageB.locator('.kcol[data-col="Done"], .kcol[data-col="完了"]').first();
    const taskInDoneB = doneColB.locator('.kcard[data-id="1"], .kcard:has-text("認証機能のFirebase移行")');
    await expect(taskInDoneB).toBeVisible({ timeout: 3000 });
  });

  test('Tier 5.3: Rapid Simultaneous Dual-Context Canvas Editing', async () => {
    test.setTimeout(25000);

    await pageA.click('button.nav-item[data-view="canvas"]');
    await pageB.click('button.nav-item[data-view="canvas"]');

    const testCanvasId = 'rapid-canvas-test';

    // Initialize test canvas in RTDB
    await pageA.evaluate(cId => {
      if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        firebaseDb.ref(`canvases/${cId}`).set({
          meta: { title: 'Rapid Concurrent Canvas', createdAt: Date.now(), createdBy: '山口' },
          blocks: {
            block_1: { type: 'heading', text: 'Initial Header', order: 0 },
            block_2: { type: 'text', text: 'Initial Content', order: 1 }
          }
        });
      }
    }, testCanvasId);

    await pageA.waitForTimeout(500);

    // Rapid simultaneous block edits from Page A and Page B
    const editPromises = [
      // Page A edits block_1 5 times
      pageA.evaluate(async cId => {
        for (let i = 1; i <= 5; i++) {
          if (typeof firebaseDb !== 'undefined' && firebaseDb) {
            firebaseDb.ref(`canvases/${cId}/blocks/block_1/text`).set(`Header Edit A-${i}`);
          }
          await new Promise(r => setTimeout(r, 40));
        }
      }, testCanvasId),

      // Page B edits block_2 5 times
      pageB.evaluate(async cId => {
        for (let i = 1; i <= 5; i++) {
          if (typeof firebaseDb !== 'undefined' && firebaseDb) {
            firebaseDb.ref(`canvases/${cId}/blocks/block_2/text`).set(`Body Edit B-${i}`);
          }
          await new Promise(r => setTimeout(r, 40));
        }
      }, testCanvasId)
    ];

    await Promise.all(editPromises);

    // Set known final text
    await pageA.evaluate(cId => {
      if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        firebaseDb.ref(`canvases/${cId}/blocks/block_1/text`).set('FINAL_HEADER_A');
      }
    }, testCanvasId);

    await pageB.evaluate(cId => {
      if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        firebaseDb.ref(`canvases/${cId}/blocks/block_2/text`).set('FINAL_BODY_B');
      }
    }, testCanvasId);

    // Open/render canvas on pageB if function exists or inspect RTDB directly
    await pageB.waitForTimeout(1000);

    const finalBlocksOnB = await pageB.evaluate(async cId => {
      if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        const snap = await firebaseDb.ref(`canvases/${cId}/blocks`).once('value');
        return snap.val();
      }
      return null;
    }, testCanvasId);

    expect(finalBlocksOnB).not.toBeNull();
    expect(finalBlocksOnB.block_1.text).toBe('FINAL_HEADER_A');
    expect(finalBlocksOnB.block_2.text).toBe('FINAL_BODY_B');
  });

});
