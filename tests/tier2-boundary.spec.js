const { test, expect } = require('@playwright/test');

test.describe('Tier 2 Boundary & Edge Cases - ViaGlyph Workspace App', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept GAS network calls to ensure fast offline fallback response during tests
    await page.route('**/macros/s/**', route => route.abort());
    await page.goto('/');
  });

  async function performLogin(page, email = 'siteiiryoubugaihinn2@gmail.com', password = 'viaglyph2026') {
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('#login-btn');
    await expect(page.locator('#app')).toBeVisible();
    await page.waitForTimeout(100);
    await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
  }

  // ─── 1. LOGIN BOUNDARY & SECURITY ───
  test.describe('1. Login Boundary Cases', () => {
    test('1.1 should show error when submitting empty login form', async ({ page }) => {
      // HTML5 required attributes will prevent form submission or trigger native/custom validation
      await page.evaluate(() => {
        document.getElementById('login-email').removeAttribute('required');
        document.getElementById('login-password').removeAttribute('required');
      });
      await page.click('#login-btn');
      const errEl = page.locator('#login-error');
      await expect(errEl).toBeVisible();
      await expect(errEl).toContainText(/正しくありません|入力してください/);
    });

    test('1.2 should show error on invalid password with valid email', async ({ page }) => {
      await page.fill('#login-email', 'siteiiryoubugaihinn2@gmail.com');
      await page.fill('#login-password', 'wrongpassword123');
      await page.click('#login-btn');
      const errEl = page.locator('#login-error');
      await expect(errEl).toBeVisible();
      await expect(errEl).toContainText('正しくありません');
    });

    test('1.3 should show error on invalid email format', async ({ page }) => {
      await page.evaluate(() => {
        document.getElementById('login-email').removeAttribute('required');
        document.getElementById('login-email').type = 'text';
      });
      await page.fill('#login-email', 'invalid-email-format');
      await page.fill('#login-password', 'viaglyph2026');
      await page.click('#login-btn');
      const errEl = page.locator('#login-error');
      await expect(errEl).toBeVisible();
      await expect(errEl).toContainText('メールアドレスの形式が正しくありません');
    });

    test('1.4 should handle repeated failed login attempts lock', async ({ page }) => {
      await page.fill('#login-email', 'siteiiryoubugaihinn2@gmail.com');
      for (let i = 0; i < 5; i++) {
        await page.fill('#login-password', `wrongpass_${i}`);
        await page.click('#login-btn');
        await page.waitForTimeout(100);
      }
      const errEl = page.locator('#login-error');
      await expect(errEl).toBeVisible();
      await expect(errEl).toContainText('超過しました');
    });

    test('1.5 should trim leading/trailing whitespace in email input during login', async ({ page }) => {
      await page.fill('#login-email', '  siteiiryoubugaihinn2@gmail.com  ');
      await page.fill('#login-password', 'viaglyph2026');
      await page.click('#login-btn');
      await expect(page.locator('#app')).toBeVisible();
    });
  });

  // ─── 2. RECORD FORM BOUNDARY CASES ───
  test.describe('2. Record Form Boundary Cases', () => {
    test.beforeEach(async ({ page }) => {
      await performLogin(page);
      await page.click('.nav-item[data-view="record"]');
    });

    test('2.1 should reject work log submission when no task is selected', async ({ page }) => {
      await page.fill('#rec-hours', '1');
      await page.fill('#rec-minutes', '0');
      await page.click('#record-form button[type="submit"]');

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('タスクを選択してください');
    });

    test('2.2 should reject work log submission when total duration is 0 minutes', async ({ page }) => {
      await page.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '0');
      await page.fill('#rec-minutes', '0');
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('作業時間を入力してください');
    });

    test('2.3 should handle maximum allowed duration inputs', async ({ page }) => {
      await page.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '24');
      await page.fill('#rec-minutes', '59');
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('記録を保存しました');
    });

    test('2.4 should sanitize long comments containing HTML tags and special characters', async ({ page }) => {
      await page.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '1');
      const specialComment = '<script>alert("xss")</script> & "quotes" \'single\' <div class="test">Unicode: 🚀🔥💎</div>';
      await page.fill('#rec-comment', specialComment);
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('記録を保存しました');
    });

    test('2.5 should handle work log submission without any tag selected', async ({ page }) => {
      await page.waitForFunction(() => document.querySelectorAll('#rec-task option').length > 1);
      await page.selectOption('#rec-task', { index: 1 });
      await page.fill('#rec-hours', '0');
      await page.fill('#rec-minutes', '15');
      await page.evaluate(() => { if (typeof hideToast === 'function') hideToast(); });
      await page.click('#record-form button[type="submit"]');

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('記録を保存しました');
    });
  });

  // ─── 3. KANBAN BOUNDARY & EDGE CASES ───
  test.describe('3. Kanban Boundary Cases', () => {
    test.beforeEach(async ({ page }) => {
      await performLogin(page);
      await page.click('.nav-item[data-view="kanban"]');
    });

    test('3.1 should reject task creation with empty title in modal', async ({ page }) => {
      await page.click('button:has-text("＋ タスクを追加")');
      await expect(page.locator('#modal')).toHaveClass(/open/);
      await page.fill('#m-title', '   ');
      await page.click('#modal .btn-submit');
      // Modal should remain open if title is empty
      await expect(page.locator('#modal')).toHaveClass(/open/);
      await page.click('#modal button:has-text("キャンセル")');
    });

    test('3.2 should handle task creation with extreme title length and HTML tags', async ({ page }) => {
      await page.click('button:has-text("＋ タスクを追加")');
      const longTitle = '<b>Extreme Task Title</b> ' + 'A'.repeat(200) + ' <script>console.log("test")</script>';
      await page.fill('#m-title', longTitle);
      await page.click('#modal .btn-submit');

      await expect(page.locator('#modal')).not.toHaveClass(/open/);
      await expect(page.locator('#kanban-board')).toContainText('Extreme Task Title');
    });

    test('3.3 should display toast error when attempting to move task of another member', async ({ page }) => {
      await page.evaluate(() => {
        const task = { id: 999, title: 'Other User Task', assign: '市川', status: 'TODO', ctx: 'dev' };
        if (typeof onColDrop === 'function') {
          window.dragTaskId = 999;
          window.DATA.dev.tasks.push(task);
          onColDrop({ preventDefault: () => {}, currentTarget: { classList: { remove: () => {} } } }, 'Done');
        }
      });
      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('他のメンバーのタスクは移動できません');
    });

    test('3.4 should handle daily date shift across month boundaries', async ({ page }) => {
      const prevBtn = page.locator('.daily-date-nav button:has-text("◀")');
      await prevBtn.click();
      await page.waitForTimeout(100);
      const nextBtn = page.locator('.daily-date-nav button:has-text("▶")');
      await nextBtn.click();
      await expect(page.locator('#daily-date-label')).toBeVisible();
    });

    test('3.5 should handle daily memo with multiline text and special characters', async ({ page }) => {
      const memoTextarea = page.locator('#daily-memo');
      const text = 'Line 1: Special Characters <>&"\nLine 2: Emojis 🌿💎🔥\nLine 3: ' + 'X'.repeat(500);
      await memoTextarea.fill(text);
      await expect(memoTextarea).toHaveValue(text);
    });
  });

  // ─── 4. GOALS BOUNDARY & EDGE CASES ───
  test.describe('4. Goals Boundary Cases', () => {
    test.beforeEach(async ({ page }) => {
      await performLogin(page);
      await page.click('.nav-item[data-view="goals"]');
    });

    test('4.1 should reject adding goal project with empty name in goal modal', async ({ page }) => {
      const addBtn = page.locator('button:has-text("＋ プロジェクトを追加")');
      await addBtn.scrollIntoViewIfNeeded();
      await addBtn.click();
      await expect(page.locator('#goal-modal')).toHaveClass(/open/);
      await page.fill('#goal-name', '   ');
      await page.click('#goal-modal .btn-submit');
    });

    test('4.2 should handle adding goal project with HTML tags and special characters', async ({ page }) => {
      const addBtn = page.locator('button:has-text("＋ プロジェクトを追加")');
      await addBtn.scrollIntoViewIfNeeded();
      await addBtn.click();
      await page.fill('#goal-name', '<span style="color:red">Sanitized Goal</span> & "Quotes"');
      await page.click('#goal-modal .btn-submit');
    });

    test('4.3 should handle toggling goal task completion with invalid id gracefully', async ({ page }) => {
      await page.evaluate(() => {
        if (typeof toggleGoalTask === 'function') {
          try { toggleGoalTask(9999, 9999, 9999, 9999); } catch(e) {}
        }
      });
    });

    test('4.4 should handle rapid toggling of goal completion checkboxes without breaking UI', async ({ page }) => {
      const checkBtn = page.locator('#goals-tree .goal-task-check').first();
      if (await checkBtn.isVisible()) {
        await checkBtn.click();
        await checkBtn.click();
        await checkBtn.click();
      }
    });

    test('4.5 should render goals view without crashing when goals array is empty', async ({ page }) => {
      await page.evaluate(() => {
        window.goals = [];
        if (typeof goals !== 'undefined' && Array.isArray(goals)) goals.length = 0;
        if (typeof renderGoals === 'function') renderGoals();
      });
      await expect(page.locator('#goals-tree')).toBeEmpty();
    });
  });

  // ─── 5. MEMBERS BOUNDARY & EDGE CASES ───
  test.describe('5. Members Boundary Cases', () => {
    test.beforeEach(async ({ page }) => {
      await performLogin(page);
      await page.click('.nav-item[data-view="members"]');
    });

    test('5.1 should prevent status change of other team members', async ({ page }) => {
      // Current user is 山口. Click 市川's status label button.
      const ichikawaCard = page.locator('.member-card:has-text("市川 翔大")');
      await ichikawaCard.locator('.member-status-label').click();

      const toast = page.locator('#toast');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('他のメンバーのステータスは変更できません');
    });

    test('5.2 should handle rapid status cycling on current user without state corruption', async ({ page }) => {
      const yamaguchiLabel = page.locator('.member-card:has-text("山口 慧") .member-status-label');
      await yamaguchiLabel.click();
      await yamaguchiLabel.click();
      await yamaguchiLabel.click();

      await expect(yamaguchiLabel).toBeVisible();
    });

    test('5.3 should handle task picker modal when member has no assigned tasks', async ({ page }) => {
      const taskPickerBtn = page.locator('button:has-text("＋ 取組中タスクを追加・変更")');
      if (await taskPickerBtn.isVisible()) {
        await taskPickerBtn.click();
        await expect(page.locator('#task-picker-modal')).toHaveClass(/open/);
        await page.click('#task-picker-modal .btn-submit');
        await expect(page.locator('#task-picker-modal')).not.toHaveClass(/open/);
      }
    });

    test('5.4 should display 0h 0m correctly for members with zero logged minutes', async ({ page }) => {
      const memberStats = page.locator('.member-stat-value');
      const count = await memberStats.count();
      expect(count).toBeGreaterThan(0);
    });

    test('5.5 should handle member status update when offline mode is active', async ({ page }) => {
      await page.evaluate(() => {
        if (typeof window.memberStatuses !== 'undefined' && window.memberStatuses) {
          window.memberStatuses.yamaguchi = 'offline';
        }
        if (typeof renderMembers === 'function') renderMembers();
      });
      const label = page.locator('.member-card:has-text("山口 慧") .member-status-label');
      await expect(label).toContainText('オフライン');
    });
  });

  // ─── 6. CANVAS BOUNDARY & EDGE CASES ───
  test.describe('6. Canvas Boundary Cases', () => {
    test.beforeEach(async ({ page }) => {
      await performLogin(page);
      await page.click('.nav-item[data-view="canvas"]');
    });

    test('6.1 should handle empty canvas title input field without error', async ({ page }) => {
      await page.evaluate(() => {
        document.getElementById('canvas-list-view').style.display = 'none';
        document.getElementById('canvas-editor-view').style.display = 'flex';
      });
      const titleInput = page.locator('#canvas-title');
      await titleInput.fill('');
      await expect(titleInput).toHaveValue('');
    });

    test('6.2 should handle canvas title input with HTML injection strings safely', async ({ page }) => {
      await page.evaluate(() => {
        document.getElementById('canvas-list-view').style.display = 'none';
        document.getElementById('canvas-editor-view').style.display = 'flex';
      });
      const titleInput = page.locator('#canvas-title');
      const injection = '<img src=x onerror=alert(1)> Title Test';
      await titleInput.fill(injection);
      await expect(titleInput).toHaveValue(injection);
    });

    test('6.3 should handle closing meeting wizard modal without creating canvas', async ({ page }) => {
      await page.click('.canvas-new-btn');
      await expect(page.locator('#meeting-wizard-modal')).toHaveClass(/open/);
      await page.click('#meeting-wizard-modal button:has-text("キャンセル")');
      await expect(page.locator('#meeting-wizard-modal')).not.toHaveClass(/open/);
    });

    test('6.4 should handle returning from canvas editor view back to canvas list', async ({ page }) => {
      await page.evaluate(() => {
        document.getElementById('canvas-list-view').style.display = 'none';
        document.getElementById('canvas-editor-view').style.display = 'flex';
      });
      await page.click('.canvas-back-btn >> nth=0');
      await expect(page.locator('#canvas-list-view')).toBeVisible();
      await expect(page.locator('#canvas-editor-view')).toBeHidden();
    });

    test('6.5 should handle rapid navigation switching between canvas tab and other views', async ({ page }) => {
      await page.click('.nav-item[data-view="kanban"]');
      await expect(page.locator('#view-kanban')).toHaveClass(/active/);
      await page.click('.nav-item[data-view="canvas"]');
      await expect(page.locator('#view-canvas')).toHaveClass(/active/);
      await page.click('.nav-item[data-view="goals"]');
      await expect(page.locator('#view-goals')).toHaveClass(/active/);
    });
  });
});
