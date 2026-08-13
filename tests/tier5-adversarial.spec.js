const { test, expect } = require('@playwright/test');

/**
 * Helper function to handle user login in a specific browser page
 * and dismiss welcome toast so form toast assertions operate cleanly.
 */
async function loginUser(page, email = 'siteiiryoubugaihinn2@gmail.com', password = 'viaglyph2026') {
  await page.goto('/');
  const loginForm = page.locator('#login-form');
  if (await loginForm.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('#login-btn');
    await page.waitForSelector('#app', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(100);
  }
  // Dismiss any active toast immediately
  await page.evaluate(() => {
    if (typeof hideToast === 'function') hideToast();
    else {
      const t = document.getElementById('toast');
      if (t) t.classList.remove('show');
    }
  });
}

test.describe('Tier 5 Adversarial Coverage Hardening: Network Disconnect/Reconnect & Edge Case Payloads', () => {

  // ─────────────────────────────────────────────────────────────
  // SECTION 1: NETWORK DISCONNECT & RECONNECT RESILIENCE
  // ─────────────────────────────────────────────────────────────
  test.describe('1. Network Disconnect & Reconnect Resilience', () => {
    
    test('1.1 UI operates gracefully during network disconnect (offline) and recovers after reconnection', async ({ context, page }) => {
      test.setTimeout(30000);
      await loginUser(page);

      // 1. Go offline via Playwright context
      await context.setOffline(true);

      // 2. Perform offline operations in UI (Navigate tabs, attempt task creation, memo typing)
      await page.click('.nav-item[data-view="kanban"]');
      await expect(page.locator('#view-kanban')).toHaveClass(/active/);

      // Attempt to create a task while offline
      await page.click('button:has-text("＋ タスクを追加")');
      await page.fill('#m-title', 'Offline Created Task');
      await page.click('#modal .btn-submit');
      
      // Verify modal closes and UI does not freeze or throw unhandled exceptions
      await expect(page.locator('#modal')).not.toHaveClass(/open/);

      // Navigate to Record view offline and enter memo
      await page.click('.nav-item[data-view="record"]');
      await expect(page.locator('#view-record')).toHaveClass(/active/);

      // 3. Re-enable network connection
      await context.setOffline(false);
      await page.waitForTimeout(500);

      // Verify UI can perform online operations post-reconnection
      await page.click('.nav-item[data-view="members"]');
      await expect(page.locator('#view-members')).toHaveClass(/active/);
      
      // Verify status card remains interactive
      const yamaguchiLabel = page.locator('.member-card:has-text("山口 慧") .member-status-label');
      await expect(yamaguchiLabel).toBeVisible();
    });

    test('1.2 API methods handle network drops gracefully', async ({ context, page }) => {
      test.setTimeout(30000);
      await loginUser(page);

      const uncaughtErrors = [];
      page.on('pageerror', err => uncaughtErrors.push(err));

      // Cut network
      await context.setOffline(true);

      // Call API methods safely while offline using isolated test keys
      await page.evaluate(async () => {
        if (typeof API !== 'undefined') {
          try {
            await API.addTask({ id: 't_offline_api', title: 'API Offline Task', status: 'TODO', assign: '山口', ctx: 'dev' });
            await API.addWorkLog({ id: 'wl_offline_api', taskId: 1, minutes: 15, tags: ['dev'], comment: 'Offline Log', user: '山口', date: '2026-08-11' });
            await API.updateMemberStatus('山口', 'away');
            await API.saveDailyMemo('2099-01-01', '山口', 'Offline Test Memo');
          } catch (e) {
            console.warn('Handled offline API error/fallback:', e);
          }
        }
      });

      // Restore network
      await context.setOffline(false);

      // Assert no uncaught page crash errors occurred
      expect(uncaughtErrors).toHaveLength(0);
    });

    test('1.3 Multi-client real-time sync resumes automatically after client recovers network connection', async ({ browser }) => {
      test.setTimeout(30000);

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await loginUser(pageA, 'siteiiryoubugaihinn2@gmail.com');
      await loginUser(pageB, 'shotaatut@gmail.com');

      // Context B goes offline
      await contextB.setOffline(true);

      // Context A creates a worklog while Context B is offline
      const timeStamp = Date.now();
      const logComment = `Sync test after reconnect ${timeStamp}`;

      await pageA.click('.nav-item[data-view="record"]');
      await pageA.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await pageA.selectOption('#rec-task', { index: 1 });
      await pageA.fill('#rec-hours', '1');
      await pageA.fill('#rec-comment', logComment);
      await pageA.click('#record-form button[type="submit"]');
      await expect(pageA.locator('#toast')).toContainText('記録を保存しました');
      await pageA.waitForTimeout(500);

      // Context B comes back online
      await contextB.setOffline(false);
      await pageB.evaluate(async () => {
        if (window.firebaseDb && typeof window.firebaseDb.goOnline === 'function') {
          try { window.firebaseDb.goOnline(); } catch(e){}
        }
        if (window.API && typeof window.API.syncAll === 'function') {
          await window.API.syncAll();
        }
      });
      await pageB.waitForTimeout(1000);

      // Navigate Context B to trigger view refresh & verify RTDB sync
      await pageB.click('.nav-item[data-view="kanban"]');
      await pageB.click('.nav-item[data-view="record"]');
      await pageB.evaluate(() => { if (typeof renderTimeline === 'function') renderTimeline(); });
      
      // Verify Context B receives the worklog submitted while it was offline
      const logOnB = pageB.locator('#timeline-list, #daily-done-list').locator(`:has-text("${logComment}")`).first();
      await expect(logOnB).toBeVisible({ timeout: 5000 });

      await contextA.close();
      await contextB.close();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SECTION 2: ADVERSARIAL EDGE CASE PAYLOADS
  // ─────────────────────────────────────────────────────────────
  test.describe('2. Adversarial Edge Case Payloads & Input Sanitization', () => {
    test.beforeEach(async ({ page }) => {
      await loginUser(page);
    });

    test('2.1 HTML/Script Injection payload in Task Title is rendered safely without script execution', async ({ page }) => {
      let alertFired = false;
      page.on('dialog', async dialog => {
        alertFired = true;
        await dialog.dismiss();
      });

      await page.click('.nav-item[data-view="kanban"]');
      await page.click('button:has-text("＋ タスクを追加")');

      const xssPayload = `<script>alert('XSS_TASK_TITLE')</script><img src=x onerror="alert('XSS_IMG')"><b onmouseover="alert('XSS')">XSS Task Title</b>`;
      await page.fill('#m-title', xssPayload);
      await page.click('#modal .btn-submit');

      await page.waitForTimeout(500);

      // Ensure no alert dialog was triggered by injected script / event handler
      expect(alertFired).toBe(false);

      // Verify raw script code is not executed as DOM elements
      const scriptElements = await page.locator('#kanban-board script').count();
      expect(scriptElements).toBe(0);
    });

    test('2.2 HTML/Script Injection payload in WorkLog comment is sanitized safely', async ({ page }) => {
      let alertFired = false;
      page.on('dialog', async dialog => {
        alertFired = true;
        await dialog.dismiss();
      });

      await page.click('.nav-item[data-view="record"]');
      await page.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '1');

      const xssComment = `<iframe src="javascript:alert('XSS_COMMENT')"></iframe><svg onload=alert(1)></svg>Special Log Comment`;
      await page.fill('#rec-comment', xssComment);
      await page.click('#record-form button[type="submit"]');

      await page.waitForTimeout(500);

      expect(alertFired).toBe(false);

      // Check timeline rendering
      const timelineItem = page.locator('#timeline-list .record-card, #timeline-list .timeline-item').first();
      await expect(timelineItem).toBeVisible();
    });

    test('2.3 Extreme Text String (5,000 chars & Special Unicode/Emojis) in Daily Memo', async ({ page }) => {
      await page.click('.nav-item[data-view="kanban"]');
      
      const extremeText = '🚀🔥💎 ' + 'あ'.repeat(2500) + ' \n\t\n zero-width: \u200B\u200C\u200D ' + 'Z'.repeat(2500);
      const memoTextarea = page.locator('#daily-memo');
      await memoTextarea.fill(extremeText);

      // Trigger change/blur to save
      await memoTextarea.blur();
      await page.waitForTimeout(300);

      // Verify text in memoTextarea is preserved accurately
      await expect(memoTextarea).toHaveValue(extremeText);
    });

    test('2.4 Zero, Negative, and Extreme Duration Inputs in WorkLog submission', async ({ page }) => {
      await page.click('.nav-item[data-view="record"]');
      await page.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await page.selectOption('#rec-task', { index: 1 });

      // Dismiss any toast
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });

      // Negative duration input (-2 hours, -30 minutes)
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '-2');
      await page.fill('#rec-minutes', '-30');
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('作業時間を入力してください');

      // Dismiss toast
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });

      // Zero duration (0 hours, 0 minutes)
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '0');
      await page.fill('#rec-minutes', '0');
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      await expect(toast).toBeVisible();
      await expect(toast).toContainText('作業時間を入力してください');

      // Dismiss toast
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });

      // Extreme duration (99 hours 99 minutes)
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '99');
      await page.fill('#rec-minutes', '99');
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      await expect(toast).toBeVisible();
      await expect(toast).toContainText('記録を保存しました');
    });

    test('2.5 Robust handling of empty objects and missing schema fields in API calls', async ({ page }) => {
      const results = await page.evaluate(async () => {
        const res = {};
        if (typeof API === 'undefined') return { error: 'API not defined' };

        try {
          // 1. Missing fields task
          await API.addTask({});
          res.addTaskEmpty = true;
        } catch (e) { res.addTaskEmpty = false; }

        try {
          // 2. Missing fields workLog
          await API.addWorkLog({});
          res.addWorkLogEmpty = true;
        } catch (e) { res.addWorkLogEmpty = false; }

        try {
          // 3. Update task with empty updates
          await API.updateTask(1, {}, 'dev');
          res.updateTaskEmpty = true;
        } catch (e) { res.updateTaskEmpty = false; }

        try {
          // 4. Date formatting in saveDailyMemo
          await API.saveDailyMemo('2026-08-11', '山口', 'Memo content');
          res.saveDailyMemo = true;
        } catch (e) { res.saveDailyMemo = false; }

        return res;
      });

      expect(results.addTaskEmpty).toBe(true);
      expect(results.addWorkLogEmpty).toBe(true);
      expect(results.updateTaskEmpty).toBe(true);
      expect(results.saveDailyMemo).toBe(true);
    });

    test('2.6 Boundary Dates handling (1970-01-01, 2099-12-31, Leap year dates)', async ({ page }) => {
      await page.click('.nav-item[data-view="record"]');

      const dateInput = page.locator('#rec-date');
      if (await dateInput.isVisible()) {
        // Epoch boundary
        await dateInput.fill('1970-01-01');
        await expect(dateInput).toHaveValue('1970-01-01');

        // Far future boundary
        await dateInput.fill('2099-12-31');
        await expect(dateInput).toHaveValue('2099-12-31');

        // Leap year boundary (2028-02-29)
        await dateInput.fill('2028-02-29');
        await expect(dateInput).toHaveValue('2028-02-29');
      }
    });

  });

});
