// ═══ ViaGLYPH Canvas — Realtime Collaborative Editor ═══
// Firebase Realtime Database でリアルタイム同期

let canvasCurrentId = null;
let canvasBlocks = [];
let canvasListeners = [];
let presenceRef = null;
let canvasSaveTimeout = null;
let isComposing = false;       // IME変換中フラグ
let pendingRender = false;     // IME中に溜めたレンダリングリクエスト
let isTypingMention = false;   // タイピングによるメンションフラグ

// ─── INIT FIREBASE ───
function initFirebase() {
  if (window.firebaseApp && window.firebaseDb) {
    return window.firebaseDb;
  }
  try {
    if (typeof firebase !== 'undefined') {
      window.firebaseApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
      window.firebaseDb = firebase.database();
      console.log('🔥 Firebase initialized (canvas)');
    }
  } catch (e) {
    console.error('Firebase init error:', e);
  }
  return window.firebaseDb;
}

// ─── CANVAS LIST ───
function renderCanvasList() {
  initFirebase();
  const container = document.getElementById('canvas-list-container');
  if (!container) return;

  const listRef = firebaseDb.ref('canvases');
  listRef.off();
  listRef.on('value', (snap) => {
    const data = snap.val() || {};
    const canvases = Object.entries(data).map(([id, c]) => ({
      id,
      title: c.meta?.title || '無題のキャンバス',
      updatedAt: c.meta?.updatedAt || 0,
      updatedBy: c.meta?.updatedBy || '',
      blockCount: c.blocks ? Object.keys(c.blocks).length : 0
    })).sort((a, b) => b.updatedAt - a.updatedAt);

    container.innerHTML = canvases.map(c => {
      const timeAgo = getTimeAgo(c.updatedAt);
      return `<div class="canvas-card" onclick="openCanvas('${c.id}')">
        <div class="canvas-card-title">📄 ${escHtml(c.title)}</div>
        <div class="canvas-card-meta">
          <span>${timeAgo}</span>
          <span>${c.updatedBy ? c.updatedBy + ' が編集' : ''}</span>
          <span>${c.blockCount}ブロック</span>
        </div>
      </div>`;
    }).join('') || '<div style="text-align:center;color:var(--text-secondary);padding:40px">📝 キャンバスがありません。<br>新しく作成してみましょう。</div>';
  });
}

function createCanvas() {
  initFirebase();
  const session = API.getSession();
  const newRef = firebaseDb.ref('canvases').push();
  const id = newRef.key;
  const now = Date.now();
  newRef.set({
    meta: {
      title: '新しいキャンバス',
      createdAt: now,
      updatedAt: now,
      createdBy: session?.short || '不明',
      updatedBy: session?.short || '不明'
    },
    blocks: {
      [firebaseDb.ref().push().key]: { type: 'heading', text: '新しいキャンバス', order: 0 },
      [firebaseDb.ref().push().key]: { type: 'text', text: '', order: 1 }
    }
  }).then(() => openCanvas(id));
}

function createFutureMeeting() {
  initFirebase();
  const session = API.getSession();
  const inputDate = prompt("未来の会議の日付を入力してください（例: 2026-06-10）", new Date().toISOString().split('T')[0]);
  if (!inputDate) return;
  const newRef = firebaseDb.ref('canvases').push();
  const id = newRef.key;
  const now = Date.now();
  newRef.set({
    meta: {
      title: `${inputDate} の会議`,
      createdAt: now,
      updatedAt: now,
      createdBy: session?.short || '不明',
      updatedBy: session?.short || '不明'
    },
    blocks: {
      [firebaseDb.ref().push().key]: { type: 'heading', text: `${inputDate} の会議アジェンダ`, order: 0 },
      [firebaseDb.ref().push().key]: { type: 'text', text: '', order: 1 }
    }
  }).then(() => openCanvas(id));
}

// ─── CANVAS EDITOR ───
function openCanvas(id) {
  // IDバリデーション（Firebase push key形式のみ許可）
  if (!id || !/^[-\w]{10,30}$/.test(id)) { console.error('Invalid canvas ID'); return; }
  canvasCurrentId = id;
  document.getElementById('canvas-list-view').style.display = 'none';
  document.getElementById('canvas-editor-view').style.display = 'flex';

  initFirebase();
  const session = API.getSession();

  // Title
  const titleRef = firebaseDb.ref(`canvases/${id}/meta/title`);
  titleRef.on('value', (snap) => {
    const titleInput = document.getElementById('canvas-title');
    if (titleInput && document.activeElement !== titleInput) {
      titleInput.value = snap.val() || '無題';
    }
  });

  // Blocks — IME中はレンダリングをスキップ
  const blocksRef = firebaseDb.ref(`canvases/${id}/blocks`);
  blocksRef.on('value', (snap) => {
    const data = snap.val() || {};
    canvasBlocks = Object.entries(data).map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (isComposing) {
      pendingRender = true;  // IME中は後で
      return;
    }
    renderBlocks();
  });

  // Presence
  setupPresence(id, session);

  // IMEイベントをdocumentレベルでリッスン
  const blocksContainer = document.getElementById('canvas-blocks');
  blocksContainer.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  blocksContainer.addEventListener('compositionend', (e) => {
    isComposing = false;
    // 変換確定時にテキストを保存
    const el = e.target;
    const key = el.dataset?.key || el.parentElement?.dataset?.key;
    if (key && canvasCurrentId) {
      const text = el.textContent || '';
      const session = API.getSession();
      firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set(text);
      firebaseDb.ref(`canvases/${canvasCurrentId}/meta`).update({
        updatedAt: Date.now(),
        updatedBy: session?.short || ''
      });
    }
    // 溜まったレンダリングを実行（少し遅延させてDOM更新後に）
    if (pendingRender) {
      pendingRender = false;
      setTimeout(() => renderBlocks(), 50);
    }
  });
}

function closeCanvas() {
  if (canvasCurrentId && firebaseDb) {
    firebaseDb.ref(`canvases/${canvasCurrentId}/meta/title`).off();
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks`).off();
    cleanupPresence();
  }
  isComposing = false;
  pendingRender = false;
  canvasCurrentId = null;
  document.getElementById('canvas-list-view').style.display = 'block';
  document.getElementById('canvas-editor-view').style.display = 'none';
}

function deleteCanvas() {
  if (!canvasCurrentId || !confirm('このキャンバスを削除しますか？')) return;
  // PM v2 Taskは会議を削除しても消さない。出典だけを削除済みにする。
  if (window.PM?.tasks) {
    window.PM.tasks.filter(task => task.sourceMeetingId === canvasCurrentId).forEach(task => {
      window.PM.update(`pm/tasks/${task.id}`, { sourceMeetingDeleted: true, updatedAt: new Date().toISOString(), updatedBy: window.PM.actor() }).catch(() => {});
    });
  }
  firebaseDb.ref(`canvases/${canvasCurrentId}`).remove();
  closeCanvas();
  toast('🗑 キャンバスを削除しました');
}

// ─── RENDER BLOCKS ───
function renderBlocks() {
  const container = document.getElementById('canvas-blocks');
  if (!container) return;
  // IME中は絶対にレンダリングしない
  if (isComposing) { pendingRender = true; return; }

  const focused = document.activeElement;
  const focusedKey = focused?.dataset?.key || focused?.closest?.('[data-key]')?.dataset?.key;
  let caretOffset = null;
  if (focusedKey) {
    caretOffset = getCaretCharacterOffsetWithin(focused);
  }

  container.innerHTML = canvasBlocks.map((block, i) => {
    if (block.type === 'divider') {
      return `<div class="canvas-block block-divider" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
      </div>`;
    }
    if (block.type === 'checkbox') {
      const checked = block.checked ? 'checked' : '';
      return `<div class="canvas-block block-checkbox" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div class="cb-check ${checked}" onclick="toggleCheck('${block.key}')">
          ${block.checked ? '✓' : ''}
        </div>
        <div class="cb-text ${block.checked ? 'checked-text' : ''}" contenteditable="true"
          data-key="${block.key}" data-field="text"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}</div>
      </div>`;
    }
    // ゴールタスクブロック
    if (block.type === 'goal-task') {
      let isDone = false;
      let taskMeta = null;
      if (window.PM?.task && block.meta?.taskId) {
        taskMeta = window.PM.task(block.meta.taskId);
        isDone = taskMeta?.status === 'done';
      }
      if (block.meta && block.meta.taskId && typeof goals !== 'undefined') {
        const proj = goals.find(p => p.id === block.meta.projId);
        const bg = proj?.bigGoals.find(b => b.id === block.meta.bigId);
        const mg = bg?.midGoals.find(m => m.id === block.meta.midId);
        const task = mg?.tasks.find(t => t.id === block.meta.taskId);
        if (task) isDone = task.done;
      }
      const mgName = taskMeta ? `${window.PM.project(taskMeta.projectId)?.name || 'Project'} / ${window.PM.milestone(taskMeta.milestoneId)?.name || 'Milestone'}` : (block.meta?.mgName || '目標');
      return `<div class="canvas-block block-checkbox" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div class="cb-check ${isDone ? 'checked' : ''}" onclick="toggleGoalTaskCheckbox('${block.key}')">
          ${isDone ? '✓' : ''}
        </div>
        <div class="cb-text ${isDone ? 'checked-text' : ''}" contenteditable="true"
          data-key="${block.key}" data-field="text"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}&nbsp;<span class="tag" style="font-size:0.7rem;vertical-align:middle;user-select:none;margin-left:4px;" contenteditable="false">🎯 ${mgName}</span></div>
      </div>`;
    }
    // エリアヘッダー（エリア分け）
    if (block.type === 'area-header') {
      return `<div class="canvas-block block-area-header" data-key="${block.key}" data-idx="${i}" style="margin-top:24px; margin-bottom:8px; border-bottom: 2px solid var(--primary); padding-bottom: 4px; display:flex; align-items:center;">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div class="cb-text" contenteditable="true" style="flex:1; font-size:1.1rem; font-weight:bold; color:var(--primary);" data-key="${block.key}" data-field="text" oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${escHtml(block.text || '')}</div>
      </div>`;
    }
    // リストブロック（箇条書き）
    if (block.type === 'bullet') {
      return `<div class="canvas-block block-bullet" data-key="${block.key}" data-idx="${i}" style="display:flex; gap:8px; align-items:flex-start;">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div style="font-weight:bold; color:var(--text-main); margin-top:2px;">・</div>
        <div class="cb-text" contenteditable="true" style="flex:1;"
          data-key="${block.key}" data-field="text"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}</div>
      </div>`;
    }
    // リストブロック（番号付き）
    if (block.type === 'number') {
      let num = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (canvasBlocks[j].type === 'number') num++;
        else break;
      }
      return `<div class="canvas-block block-number" data-key="${block.key}" data-idx="${i}" style="display:flex; gap:8px; align-items:flex-start;">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div style="font-weight:bold; color:var(--text-main); margin-top:2px;">${num}.</div>
        <div class="cb-text" contenteditable="true" style="flex:1;"
          data-key="${block.key}" data-field="text"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}</div>
      </div>`;
    }
    // 見出し3
    if (block.type === 'h3') {
      return `<div class="canvas-block block-h3" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div class="cb-text" contenteditable="true" data-key="${block.key}" data-field="text"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}</div>
      </div>`;
    }
    // コードブロック
    if (block.type === 'codeblock') {
      return `<div class="canvas-block block-codeblock" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div class="cb-text" contenteditable="true" data-key="${block.key}" data-field="text"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(escHtml(block.text || ''))}</div>
      </div>`;
    }
    // テーブルブロック
    if (block.type === 'table') {
      const rows = block.tableData || [['列1','列2','列3'],['','','']]; 
      return `<div class="canvas-block block-table" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <table class="canvas-table">
          <thead><tr>${rows[0].map((h,ci) => `<th contenteditable="true" data-key="${block.key}" data-row="0" data-col="${ci}" oninput="onTableCellInput(this)">${escHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(1).map((row,ri) => `<tr>${row.map((cell,ci) => `<td contenteditable="true" data-key="${block.key}" data-row="${ri+1}" data-col="${ci}" oninput="onTableCellInput(this)">${escHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        <div class="table-controls">
          <button onclick="addTableRow('${block.key}')">＋行</button>
          <button onclick="addTableCol('${block.key}')">＋列</button>
        </div>
      </div>`;
    }
    // コールアウト（色付き）ブロック
    if (block.type?.startsWith('callout-')) {
      const color = block.type.replace('callout-','');
      const allowedColors = ['blue','green','yellow','red','purple'];
      const safeColor = allowedColors.includes(color) ? color : 'blue';
      const icons = {blue:'ℹ️',green:'✅',yellow:'⚠️',red:'🚨',purple:'💡'};
      const safeKey = escAttr(block.key);
      return `<div class="canvas-block block-callout callout-${safeColor}" data-key="${safeKey}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${safeKey}')" title="削除">✕</button>
        <span class="callout-icon">${icons[safeColor]||'💡'}</span>
        <div class="callout-text" contenteditable="true" data-key="${safeKey}"
          oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}</div>
      </div>`;
    }
    // 目次ブロック (TOC)
    if (block.type === 'toc') {
      const headers = canvasBlocks.filter(b => b.type === 'area-header' || b.type === 'heading' || b.type === 'subheading' || b.type === 'h3');
      const listHtml = headers.length > 0 
        ? headers.map(h => {
            const label = escHtml(h.text || '無題');
            const prefix = h.type === 'area-header' ? '🗂 ' : (h.type === 'heading' ? 'H1 ' : (h.type === 'subheading' ? 'H2 ' : 'H3 '));
            const indent = (h.type === 'area-header' || h.type === 'heading') ? '0' : '16px';
            return `<li style="margin-bottom:6px; padding-left:${indent};"><a href="#" onclick="event.preventDefault(); scrollToBlock('${h.key}')" style="color:var(--primary); text-decoration:none; display:inline-block; transition:opacity 0.2s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">${prefix}${label}</a></li>`;
          }).join('')
        : '<li style="color:var(--text-secondary);">見出しがありません</li>';
        
      return `<div class="canvas-block block-toc" data-key="${block.key}" data-idx="${i}" style="margin: 24px 0; padding: 16px 20px; background: var(--glass-bg); border-radius: 8px; border: 1px solid var(--neutral-border); box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--neutral-border); padding-bottom:8px;">
          <div style="font-weight:bold; color:var(--text-main); font-size:1.1rem;">📑 目次</div>
          <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        </div>
        <ul style="list-style:none; padding:0; margin:0; font-size:0.95rem;">
          ${listHtml}
        </ul>
      </div>`;
    }
    // ファイル（画像・添付）ブロック
    if (block.type === 'file') {
      const isImg = block.text.match(/\.(jpg|jpeg|png|gif|webp)$/i);
      const content = isImg 
        ? `<img src="${escAttr(block.url)}" style="max-width:100%; border-radius:8px;" alt="${escAttr(block.text)}"/>`
        : `<a href="${escAttr(block.url)}" target="_blank" style="color:var(--primary); text-decoration:underline; font-weight:500;">📎 ${escHtml(block.text)}</a>`;
        
      return `<div class="canvas-block block-file" data-key="${block.key}" data-idx="${i}">
        <button class="block-delete" onclick="deleteBlock('${block.key}')" title="削除">✕</button>
        <div class="file-content" style="padding:8px; background:var(--glass-bg); border-radius:8px; border:1px solid var(--neutral-border); display:inline-block;">
          ${content}
        </div>
      </div>`;
    }
    const cls = block.type === 'heading' ? 'block-heading' :
                block.type === 'subheading' ? 'block-subheading' :
                block.type === 'quote' ? 'block-quote' : '';
    const ph = i === 0 && block.type === 'text' ? 'data-placeholder="ここに入力..."' : 
               block.type === 'text' ? 'data-placeholder="/ でコマンド、Enter で新規ブロック"' : '';
    return `<div class="canvas-block ${cls}" contenteditable="true"
      data-key="${block.key}" data-idx="${i}" ${ph}
      oninput="onBlockInput(this)" onkeydown="onBlockKeydown(event, this)">${renderMentions(parseInlineMarkdown(escHtml(block.text || '')))}</div>`;
  }).join('');

  // Restore focus & caret
  if (focusedKey) {
    const el = container.querySelector(`[data-key="${focusedKey}"]`);
    if (el) {
      const target = el.querySelector('.cb-text') || el;
      if (target.contentEditable === 'true') {
        target.focus();
        if (caretOffset !== null) {
          try {
            setCaretPosition(target, caretOffset);
          } catch(e) {}
        }
      }
    }
  }

  const statusEl = document.getElementById('canvas-status-text');
  if (statusEl) statusEl.textContent = `${canvasBlocks.length}ブロック`;
}

// ─── BLOCK INPUT HANDLING ───
const MAX_BLOCK_TEXT_LENGTH = 10000;
const ALLOWED_BLOCK_TYPES = ['text','heading','subheading','h3','checkbox','bullet','number','quote','divider','table','callout-blue','callout-green','callout-yellow','callout-red','callout-purple','file','codeblock','goal-task','area-header','toc'];

function validateKey(key) {
  return key && /^[-\w]{10,30}$/.test(key);
}

function onBlockInput(el) {
  // IME変換中は保存しない
  if (isComposing) return;
  const key = el.dataset.key || el.parentElement?.dataset?.key;
  if (!key || !canvasCurrentId || !validateKey(key)) return;
  let text = el.textContent || '';
  
  // メンション検知（タイピングで @ を打った場合）
  if (text.endsWith('@')) {
    insertMention(true);
  }

  // テキスト長制限
  if (text.length > MAX_BLOCK_TEXT_LENGTH) {
    text = text.slice(0, MAX_BLOCK_TEXT_LENGTH);
    el.textContent = text;
  }
  
  if (text.startsWith('/')) {
    if (typeof showSlashPopup === 'function') showSlashPopup(el);
  } else {
    if (typeof hideSlashPopup === 'function') hideSlashPopup();
  }

  const session = API.getSession();

  clearTimeout(canvasSaveTimeout);
  canvasSaveTimeout = setTimeout(() => {
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set(text);
    firebaseDb.ref(`canvases/${canvasCurrentId}/meta`).update({
      updatedAt: Date.now(),
      updatedBy: session?.short || ''
    });
  }, 300);
}

function onBlockKeydown(e, el) {
  // IME変換中はキー操作を無視
  if (isComposing || e.isComposing) return;

  const key = el.dataset.key || el.parentElement?.dataset?.key;
  const idx = parseInt(el.dataset.idx || el.parentElement?.dataset?.idx || '0');
  const text = el.textContent || '';

  const currentType = canvasBlocks.find(b => b.key === key)?.type || 'text';
  const continueType = (currentType === 'bullet' || currentType === 'number' || currentType === 'checkbox') ? currentType : 'text';

  if (e.key === 'ArrowUp') {
    const prev = canvasBlocks[idx - 1];
    if (prev) {
      e.preventDefault();
      setTimeout(() => {
        const targetEl = document.querySelector(`[data-key="${prev.key}"]`);
        const target = targetEl?.querySelector('.cb-text') || targetEl;
        if (target) { target.focus(); placeCaretAtEnd(target); }
      }, 10);
    }
  }

  if (e.key === 'ArrowDown') {
    const next = canvasBlocks[idx + 1];
    if (next) {
      e.preventDefault();
      setTimeout(() => {
        const targetEl = document.querySelector(`[data-key="${next.key}"]`);
        const target = targetEl?.querySelector('.cb-text') || targetEl;
        if (target) { target.focus(); placeCaretAtEnd(target); }
      }, 10);
    }
  }

  if (typeof slashPopupOpen !== 'undefined' && slashPopupOpen) {
    const popup = document.getElementById('slash-command-popup');
    const items = popup ? Array.from(popup.querySelectorAll('.slash-item')) : [];
    const visibleItems = items.filter(i => i.style.display !== 'none');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const currentVisIdx = visibleItems.findIndex(i => i.classList.contains('selected'));
      let nextVisIdx = currentVisIdx + 1;
      if (nextVisIdx >= visibleItems.length) nextVisIdx = 0;
      visibleItems.forEach(i => i.classList.remove('selected'));
      if (visibleItems[nextVisIdx]) {
        visibleItems[nextVisIdx].classList.add('selected');
        slashPopupCurrentIndex = items.indexOf(visibleItems[nextVisIdx]);
      }
      return;
    }
    
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const currentVisIdx = visibleItems.findIndex(i => i.classList.contains('selected'));
      let nextVisIdx = currentVisIdx - 1;
      if (nextVisIdx < 0) nextVisIdx = visibleItems.length - 1;
      visibleItems.forEach(i => i.classList.remove('selected'));
      if (visibleItems[nextVisIdx]) {
        visibleItems[nextVisIdx].classList.add('selected');
        slashPopupCurrentIndex = items.indexOf(visibleItems[nextVisIdx]);
      }
      return;
    }
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const selectedItem = items[slashPopupCurrentIndex];
      if (selectedItem && selectedItem.style.display !== 'none') {
        if (typeof executeSlashCommand === 'function') executeSlashCommand(selectedItem.dataset.cmd);
      } else {
        const trimmed = text.trimStart();
        if (trimmed.length > 1) {
           const areaName = trimmed.substring(1).trim();
           convertBlock(key, 'area-header', areaName);
        }
        if (typeof hideSlashPopup === 'function') hideSlashPopup();
      }
      return;
    }
    
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof hideSlashPopup === 'function') hideSlashPopup();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    if (currentType === 'codeblock') return; // let browser insert newline
    
    const trimmed = text.trimStart();
    if (trimmed.startsWith('/') && !slashPopupOpen) {
      if (trimmed === '/task') {
        e.preventDefault(); el.textContent = ''; firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set('');
        if (typeof showTaskModal === 'function') showTaskModal(idx);
        return;
      } else if (trimmed === '/next') {
        e.preventDefault(); el.textContent = ''; firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set('');
        createFutureMeeting();
        return;
      } else if (trimmed.startsWith('/area')) {
        e.preventDefault(); convertBlock(key, 'area-header', trimmed.replace('/area', '').trim());
        return;
      } else if (trimmed.length > 1) {
        e.preventDefault();
        const areaName = trimmed.substring(1).trim();
        if (areaName) convertBlock(key, 'area-header', areaName);
        return;
      }
    }
    
    e.preventDefault();
    if (trimmed === '') {
      if (continueType !== 'text') {
        convertBlock(key, 'text', '');
      } else {
        addBlock(idx + 1, 'text', '');
      }
      return;
    }
    const sel = window.getSelection();
    const offset = sel.focusOffset;
    const before = text.slice(0, offset);
    const after = text.slice(offset);
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set(before);
    addBlock(idx + 1, continueType, after);
  }

  if (e.key === 'Backspace' && text === '' && canvasBlocks.length > 1) {
    if (continueType !== 'text') {
      e.preventDefault();
      convertBlock(key, 'text', '');
      return;
    }
    e.preventDefault();
    deleteBlock(key);
    const prev = canvasBlocks[Math.max(0, idx - 1)];
    if (prev) {
      setTimeout(() => {
        const el = document.querySelector(`[data-key="${prev.key}"]`);
        const target = el?.querySelector('.cb-text') || el;
        if (target) { target.focus(); placeCaretAtEnd(target); }
      }, 100);
    }
  }

  if (e.key === ' ') {
    const trimmed = text.trimStart();
    if (trimmed === '#') {
      e.preventDefault(); convertBlock(key, 'heading', '');
    } else if (trimmed === '##') {
      e.preventDefault(); convertBlock(key, 'subheading', '');
    } else if (trimmed === '###') {
      e.preventDefault(); convertBlock(key, 'h3', '');
    } else if (trimmed === '[]' || trimmed === '[ ]') {
      e.preventDefault(); convertBlock(key, 'checkbox', '');
    } else if (trimmed === '-' || trimmed === '*' || trimmed === '・') {
      e.preventDefault(); convertBlock(key, 'bullet', '');
    } else if (trimmed === '1.') {
      e.preventDefault(); convertBlock(key, 'number', '');
    } else if (trimmed === '>') {
      e.preventDefault(); convertBlock(key, 'quote', '');
    } else if (trimmed === '---' || trimmed === '***') {
      e.preventDefault(); convertBlock(key, 'divider', '');
      addBlock(parseInt(el.dataset.idx || '0') + 1, 'text', '');
    } else if (trimmed === '```') {
      e.preventDefault(); convertBlock(key, 'codeblock', '');
    } else if (trimmed === '/task') {
      e.preventDefault();
      el.textContent = '';
      firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set('');
      if (typeof showTaskModal === 'function') {
        showTaskModal(idx);
      } else if (typeof openAddTask === 'function') {
        openAddTask();
      }
    } else if (trimmed.startsWith('/area')) {
      e.preventDefault();
      const areaName = trimmed.replace('/area', '').trim();
      convertBlock(key, 'area-header', areaName);
    } else if (trimmed.startsWith('/') && !['/task', '/next'].includes(trimmed)) {
      e.preventDefault();
      const areaName = trimmed.substring(1).trim();
      if (areaName) convertBlock(key, 'area-header', areaName);
    } else if (trimmed === '/next') {
      e.preventDefault();
      el.textContent = '';
      firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set('');
      createFutureMeeting();
    }
  }
}

// ─── BLOCK OPERATIONS ───
function addBlock(afterIdx, type, text) {
  if (!canvasCurrentId) return;
  // typeバリデーション
  if (!ALLOWED_BLOCK_TYPES.includes(type)) { console.error('Invalid block type:', type); return; }
  if (typeof text === 'string' && text.length > MAX_BLOCK_TEXT_LENGTH) text = text.slice(0, MAX_BLOCK_TEXT_LENGTH);
  const newKey = firebaseDb.ref().push().key;
  canvasBlocks.forEach((b, i) => {
    if (i >= afterIdx) {
      firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${b.key}/order`).set(i + 1);
    }
  });
  firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${newKey}`).set({
    type, text: text || '', order: afterIdx, checked: type === 'checkbox' ? false : null
  });
  setTimeout(() => {
    const el = document.querySelector(`[data-key="${newKey}"]`);
    const target = el?.querySelector('.cb-text') || el;
    if (target) target.focus();
  }, 150);
}

function deleteBlock(key) {
  if (!canvasCurrentId || !validateKey(key)) return;
  firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}`).remove();
}

function convertBlock(key, type, text) {
  if (!canvasCurrentId) return;
  const updates = { type, text: text || '' };
  if (type === 'checkbox') updates.checked = false;
  firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}`).update(updates);
  setTimeout(() => {
    const el = document.querySelector(`[data-key="${key}"]`);
    const target = el?.querySelector('.cb-text') || el;
    if (target?.contentEditable === 'true') target.focus();
  }, 100);
}

function toggleCheck(key) {
  if (!canvasCurrentId) return;
  const block = canvasBlocks.find(b => b.key === key);
  if (block) {
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/checked`).set(!block.checked);
  }
}

function toggleGoalTaskCheckbox(key) {
  const block = canvasBlocks.find(b => b.key === key);
  if (window.PM?.task && block?.meta?.taskId) {
    const task = window.PM.task(block.meta.taskId);
    if (task) {
      window.PM.updateTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done');
      renderBlocks();
      return;
    }
  }
  if (block && block.meta && block.meta.taskId && typeof goals !== 'undefined') {
    const proj = goals.find(p => p.id === block.meta.projId);
    const bg = proj?.bigGoals.find(b => b.id === block.meta.bigId);
    const mg = bg?.midGoals.find(m => m.id === block.meta.midId);
    const task = mg?.tasks.find(t => t.id === block.meta.taskId);
    
    if (task) {
      task.done = !task.done;
      if (typeof save === 'function') save(); // Save global goals
      if (typeof renderGoals === 'function') renderGoals();
    }
    renderBlocks();
  }
}

function onCanvasTitleChange(el) {
  if (!canvasCurrentId) return;
  let title = el.value || '無題';
  if (title.length > 200) title = title.slice(0, 200);
  clearTimeout(canvasSaveTimeout);
  canvasSaveTimeout = setTimeout(() => {
    firebaseDb.ref(`canvases/${canvasCurrentId}/meta/title`).set(title);
  }, 300);
}

// ─── PRESENCE ───
function setupPresence(canvasId, session) {
  if (!firebaseDb || !session) return;
  presenceRef = firebaseDb.ref(`presence/${canvasId}/${session.short}`);
  presenceRef.set({
    name: session.short,
    emoji: session.emoji || '👤',
    bg: session.bg || '#e2e8f0',
    online: true,
    lastSeen: firebase.database.ServerValue.TIMESTAMP
  });
  presenceRef.onDisconnect().remove();

  firebaseDb.ref(`presence/${canvasId}`).on('value', (snap) => {
    const data = snap.val() || {};
    const el = document.getElementById('canvas-presence');
    if (!el) return;
    el.innerHTML = Object.values(data).filter(p => p.online).map(p => {
      const safeBg = escAttr(String(p.bg || '#e2e8f0').replace(/[^#a-fA-F0-9,().\s]/g, ''));
      const safeName = escHtml(String(p.name || ''));
      const safeEmoji = escHtml(String(p.emoji || '👤'));
      return `<div class="canvas-presence-dot online" style="background:${safeBg}" title="${safeName}">
        ${safeEmoji}
      </div>`;
    }).join('');
  });
}

function cleanupPresence() {
  if (presenceRef) { presenceRef.remove(); presenceRef = null; }
  if (canvasCurrentId && firebaseDb) {
    firebaseDb.ref(`presence/${canvasCurrentId}`).off();
  }
}

// ─── HELPERS ───
function escHtml(s) {
  if (typeof s !== 'string') s = String(s || '');
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function parseInlineMarkdown(html) {
  return html
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%; border-radius:4px; margin-top:4px;"/>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[<a href="$2" target="_blank" style="color:var(--primary);text-decoration:underline;">$1</a>]($2)')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>**$1**</strong>')
    .replace(/__([^_]+)__/g, '<strong>__$1__</strong>')
    .replace(/\*([^*]+)\*/g, '<em>*$1*</em>')
    .replace(/_([^_]+)_/g, '<em>_$1_</em>')
    .replace(/~~([^~]+)~~/g, '<del>~~$1~~</del>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--glass-bg);color:var(--primary);padding:2px 4px;border-radius:4px;">`$1`</code>');
}

function escAttr(s) {
  if (typeof s !== 'string') s = String(s || '');
  return s.replace(/[&"'<>]/g, c => ({'&':'&amp;','"':'&quot;',"'":'&#39;','<':'&lt;','>':'&gt;'}[c]));
}

function getTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '時間前';
  return Math.floor(diff / 86400000) + '日前';
}

function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function getCaretCharacterOffsetWithin(element) {
  let caretOffset = 0;
  const doc = element.ownerDocument || element.document;
  const win = doc.defaultView || doc.parentWindow;
  let sel;
  if (typeof win.getSelection !== "undefined") {
    sel = win.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(element);
      preCaretRange.setEnd(range.endContainer, range.endOffset);
      caretOffset = preCaretRange.toString().length;
    }
  }
  return caretOffset;
}

function setCaretPosition(element, offset) {
  const doc = element.ownerDocument || element.document;
  const win = doc.defaultView || doc.parentWindow;
  let sel;
  if (typeof win.getSelection !== "undefined") {
    sel = win.getSelection();
    const range = doc.createRange();
    let charCount = 0, node;
    const nodeStack = [element];
    let foundStart = false;
    let stop = false;

    while (!stop && (node = nodeStack.pop())) {
      if (node.nodeType === 3) {
        const nextCharCount = charCount + node.length;
        if (!foundStart && offset >= charCount && offset <= nextCharCount) {
          range.setStart(node, offset - charCount);
          range.collapse(true);
          foundStart = true;
          stop = true;
        }
        charCount = nextCharCount;
      } else {
        let i = node.childNodes.length;
        while (i--) {
          nodeStack.push(node.childNodes[i]);
        }
      }
    }
    if (!foundStart) {
      range.selectNodeContents(element);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ─── TABLE OPERATIONS ───
function onTableCellInput(el) {
  if (isComposing) return;
  const key = el.dataset.key;
  const row = parseInt(el.dataset.row);
  const col = parseInt(el.dataset.col);
  if (!key || !canvasCurrentId) return;
  const block = canvasBlocks.find(b => b.key === key);
  if (!block || !block.tableData) return;
  block.tableData[row][col] = el.textContent || '';
  clearTimeout(canvasSaveTimeout);
  canvasSaveTimeout = setTimeout(() => {
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/tableData`).set(block.tableData);
  }, 300);
}

function addTableRow(key) {
  const block = canvasBlocks.find(b => b.key === key);
  if (!block || !block.tableData) return;
  const cols = block.tableData[0].length;
  block.tableData.push(new Array(cols).fill(''));
  firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/tableData`).set(block.tableData);
}

function addTableCol(key) {
  const block = canvasBlocks.find(b => b.key === key);
  if (!block || !block.tableData) return;
  block.tableData.forEach(row => row.push(''));
  firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/tableData`).set(block.tableData);
}

// ─── FORMAT BAR ───
function fmtBold() { document.execCommand('bold'); }
function fmtItalic() { document.execCommand('italic'); }
function fmtStrike() { document.execCommand('strikeThrough'); }

function insertSlashBlock(type) {
  const focused = document.activeElement;
  const key = focused?.dataset?.key || focused?.closest?.('[data-key]')?.dataset?.key;
  const idx = key ? canvasBlocks.findIndex(b => b.key === key) : canvasBlocks.length - 1;
  if (type === 'table') {
    const newKey = firebaseDb.ref().push().key;
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${newKey}`).set({
      type: 'table', text: '', order: idx + 1,
      tableData: [['列1','列2','列3'],['','',''],['','','']]
    });
  } else if (type === 'divider') {
    addBlock(idx + 1, 'divider', '');
    addBlock(idx + 2, 'text', '');
  } else {
    addBlock(idx + 1, type, '');
  }
}

// ─── MENTIONS ───
function renderMentions(html) {
  // escHtml済みの文字列に対してのみ適用（安全な英数字・日本語のみマッチ）
  return html.replace(/@([\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)/g, '<span class="mention">@$1</span>');
}

function insertMention(fromTyping = false) {
  const members = (typeof MEMBERS_DATA !== 'undefined' ? MEMBERS_DATA : []).map(m => m.name || m.short);
  if (members.length === 0) {
    if (!fromTyping) document.execCommand('insertText', false, '@');
    return;
  }
  isTypingMention = fromTyping;
  
  // Create popup
  let popup = document.getElementById('mention-popup');
  if (popup) popup.remove();
  popup = document.createElement('div');
  popup.id = 'mention-popup';
  popup.className = 'mention-popup';
  popup.innerHTML = members.map(m =>
    `<div class="mention-popup-item" onclick="applyMention('${m}')">
      <div class="mp-avatar" style="background:rgba(99,102,241,.1)">👤</div>
      <span>${m}</span>
    </div>`
  ).join('');
  
  const blocks = document.getElementById('canvas-blocks');
  
  // ポップアップをキャレット位置付近に表示
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    popup.style.position = 'absolute';
    popup.style.top = (rect.bottom + window.scrollY) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
    popup.style.zIndex = '10000';
  } else {
    popup.style.position = 'fixed';
    popup.style.top = '40px'; popup.style.left = '40px';
    popup.style.zIndex = '10000';
  }
  
  document.body.appendChild(popup);
  setTimeout(() => { document.addEventListener('click', closeMentionPopup, {once:true}); }, 100);
}

function applyMention(name) {
  if (isTypingMention) {
    document.execCommand('insertText', false, name + ' ');
  } else {
    document.execCommand('insertText', false, '@' + name + ' ');
  }
  isTypingMention = false;
  closeMentionPopup();
}

function closeMentionPopup() {
  const popup = document.getElementById('mention-popup');
  if (popup) popup.remove();
}

// ─── PUBLIC API ───
function initCanvas() {
  renderCanvasList();
}

// ─── FILE UPLOAD ───
function uploadFileToStorage(event) {
  const file = event.target.files[0];
  if (!file || !canvasCurrentId) return;
  
  if (typeof toast === 'function') toast("⏳ アップロード中...");
  
  const storageRef = firebase.storage().ref();
  const fileRef = storageRef.child(`workspace/${canvasCurrentId}/${Date.now()}_${file.name}`);
  
  fileRef.put(file).then(snapshot => {
    return snapshot.ref.getDownloadURL();
  }).then(url => {
    const idx = canvasBlocks.length;
    const newKey = firebaseDb.ref().push().key;
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${newKey}`).set({
      type: 'file',
      text: file.name,
      url: url,
      order: idx
    });
    if (typeof toast === 'function') toast("✅ アップロード完了！");
    event.target.value = ''; // reset input
  }).catch(err => {
    console.error(err);
    if (typeof toast === 'function') toast("❌ アップロードに失敗しました");
    event.target.value = '';
  });
}

// =========================================
// CANVAS TASK MODAL LOGIC
// =========================================
let currentTaskTargetIdx = -1;
let canvasTaskSavePromise = null;

function showTaskModal(idx) {
  if (canvasTaskSavePromise) return toast('Taskの保存が終わるまでお待ちください。');
  currentTaskTargetIdx = idx;
  const modal = document.getElementById('canvas-task-modal');
  const sel = document.getElementById('c-task-goal');
  
  // PM v2: Project -> MilestoneをTaskの所属として選ぶ。
  if (window.PM?.projects) {
    let options = '';
    window.PM.projects.forEach(project => {
      window.PM.milestonesFor(project.id).filter(m => m.status !== 'closed').forEach(milestone => {
        options += `<option value="${project.id}:${milestone.id}">${project.name} > ${milestone.name}</option>`;
      });
    });
    sel.innerHTML = options || '<option value="">ProjectとMilestoneを先に作成してください</option>';
    document.querySelector('#canvas-task-modal h3').textContent = '📝 正式Taskを作成して会議に紐付け';
    document.getElementById('c-task-title').value = '';
    document.getElementById('c-task-due').value = '';
    document.querySelectorAll('#c-task-assign-tags .tag').forEach(t => t.classList.remove('selected'));
    modal.classList.add('open');
    document.getElementById('c-task-title').focus();
    return;
  }
  // Legacy Goal options
  let options = '';
  if (typeof goals !== 'undefined') {
    goals.forEach(proj => {
      proj.bigGoals.forEach(bg => {
        bg.midGoals.forEach(mg => {
          options += `<option value="${proj.id}:${bg.id}:${mg.id}">${proj.name} > ${bg.name} > ${mg.name}</option>`;
        });
      });
    });
  }
  
  sel.innerHTML = options || '<option value="">目標がありません（設定で追加してください）</option>';
  document.getElementById('c-task-title').value = '';
  document.getElementById('c-task-due').value = '';
  document.querySelectorAll('#c-task-assign-tags .tag').forEach(t => t.classList.remove('selected'));
  
  modal.classList.add('open');
  document.getElementById('c-task-title').focus();
}

function closeCanvasTaskModal() {
  document.getElementById('canvas-task-modal').classList.remove('open');
  if (currentTaskTargetIdx >= 0 && canvasBlocks[currentTaskTargetIdx]) {
    focusBlock(canvasBlocks[currentTaskTargetIdx].key);
  }
}

window.submitCanvasTask = function() {
  if (canvasTaskSavePromise) return canvasTaskSavePromise;
  const title = document.getElementById('c-task-title').value.trim();
  const goalVal = document.getElementById('c-task-goal').value;
  if (!title || !goalVal) {
    alert('タスク名と紐付け先を選択してください。');
    return;
  }
  
  const parts = goalVal.split(':');
  const assignees = Array.from(document.querySelectorAll('#c-task-assign-tags .selected')).map(el => el.getAttribute('data-member'));
  const due = document.getElementById('c-task-due').value;
  if (window.PM?.saveTask) {
    const projectId = parts[0];
    const milestoneId = parts[1];
    const status = assignees.length && due ? 'todo' : 'backlog';
    const sourceMeetingId = canvasCurrentId;
    const block = canvasBlocks[currentTaskTargetIdx];
    if (!sourceMeetingId || !block?.key) return toast('会議のTask作成元を確認してください。');
    const taskId = block.meta?.taskId || `canvas_${sourceMeetingId}_${block.key}`;
    const button = document.querySelector('#canvas-task-modal button.btn-submit');
    if (button) button.disabled = true;
    canvasTaskSavePromise = window.PM.saveTask({ id: taskId, title, projectId, milestoneId, assignees, dueDate: due, status, sourceMeetingId, silent: true }).then(async task => {
      if (!task) return;
      const updates = { type: 'goal-task', text: title, meta: { taskId: task.id, pm: true } };
      await firebaseDb.ref(`canvases/${sourceMeetingId}/blocks/${block.key}`).update(updates);
      if (canvasCurrentId === sourceMeetingId) {
        const currentBlock = canvasBlocks.find(item => item.key === block.key);
        if (currentBlock) Object.assign(currentBlock, updates);
        closeCanvasTaskModal(); renderBlocks();
      }
      if (typeof toast === 'function') {
        toast(window.PM?.user?.()?.sessionMode === 'direct'
          ? '正式Taskを保存しました。GitHub連携は準備中です。'
          : '正式Taskを作成し、GitHub同期を開始しました');
      }
      return task;
    }).catch(() => toast('会議へのTask連携を保存できませんでした。Taskは保持されるため、再試行してください。')).finally(() => {
      canvasTaskSavePromise = null;
      if (button) button.disabled = false;
    });
    return canvasTaskSavePromise;
  }
  const projId = parseInt(parts[0], 10);
  const bigId = parseInt(parts[1], 10);
  const midId = parseInt(parts[2], 10);
  
  const proj = goals.find(x => x.id === projId);
  const bg = proj?.bigGoals.find(x => x.id === bigId);
  const mg = bg?.midGoals.find(x => x.id === midId);
  
  if (!mg) {
    alert('目標が見つかりませんでした。');
    return;
  }
  
  // Create task in goals
  const newTaskId = Date.now();
  mg.tasks.push({
    id: newTaskId,
    name: title,
    done: false,
    assign: assignees.length ? assignees : [typeof currentUser !== 'undefined' ? currentUser : '自分'],
    due: due
  });
  
  // Save goals
  if (typeof save === 'function') save(); // from store.js
  if (typeof renderGoals === 'function') renderGoals();
  if (typeof toast === 'function') toast('タスクを作成し目標に紐付けました');
  
  // Convert current block in canvas to goal-task
  const block = canvasBlocks[currentTaskTargetIdx];
  block.type = 'goal-task';
  block.text = title;
  block.meta = { projId, bigId, midId, taskId: newTaskId, mgName: mg.name };
  
  closeCanvasTaskModal();
  renderBlocks();
  firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${block.key}`).update({ type: block.type, text: block.text, meta: block.meta });
};

// Expose to window for inline onclick in html
window.showTaskModal = showTaskModal;
window.closeCanvasTaskModal = closeCanvasTaskModal;

// =========================================
// MEETING WIZARD LOGIC
// =========================================
let currentWizardType = 'blank';

window.openMeetingWizard = function() {
  document.getElementById('meeting-wizard-modal').classList.add('open');
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  document.getElementById('wizard-date').value = today.toISOString().split('T')[0];
  wizardNext(1);
};

window.closeMeetingWizard = function() {
  document.getElementById('meeting-wizard-modal').classList.remove('open');
};

window.wizardNext = function(step) {
  document.getElementById('wizard-step-1').style.display = step === 1 ? 'block' : 'none';
  document.getElementById('wizard-step-2').style.display = step === 2 ? 'block' : 'none';
  document.getElementById('wizard-step-3').style.display = step === 3 ? 'block' : 'none';
};

window.selectWizardType = function(type, btnEl) {
  currentWizardType = type;
  document.querySelectorAll('#wizard-type-tags .tag').forEach(el => el.classList.remove('selected'));
  if (btnEl) btnEl.classList.add('selected');
};

window.toggleWizardLink = function(val) {
  document.getElementById('wizard-link-slack').style.display = val === 'slack' ? 'block' : 'none';
  const slackCanvasEl = document.getElementById('wizard-link-slack-canvas');
  if (slackCanvasEl) slackCanvasEl.style.display = val === 'slack_canvas' ? 'block' : 'none';
  document.getElementById('wizard-link-canvas').style.display = val === 'canvas' ? 'block' : 'none';
  
  if (val === 'canvas') {
    const sel = document.getElementById('wizard-canvas-select');
    sel.innerHTML = '<option value="">(連携するキャンバスを選択)</option>';
    if (typeof canvases !== 'undefined') {
      sel.innerHTML += canvases.map(c => `<option value="${c.id}">${c.title || '無題'}</option>`).join('');
    }
  }
};

window.fetchWizardSlackMessages = function() {
  const msgEl = document.getElementById('wizard-slack-fetch-msg');
  msgEl.textContent = 'Slack連携をモックアップで実行中... (完了)';
  msgEl.style.color = 'var(--ok)';
};

window.submitMeetingWizard = function() {
  const dateStr = document.getElementById('wizard-date').value;
  const linkType = document.querySelector('input[name="wizard-link"]:checked').value;
  
  let typeName = '';
  if (currentWizardType === 'daily') typeName = '定例（デイリー）';
  else if (currentWizardType === 'weekly') typeName = '定例（ウィークリー）';
  else if (currentWizardType === '1on1') typeName = '1on1';
  
  const title = (dateStr + ' ' + typeName).trim() || '新規キャンバス';
  
  closeMeetingWizard();
  initFirebase();
  const session = API.getSession();
  const newRef = firebaseDb.ref('canvases').push();
  const id = newRef.key;
  const now = Date.now();
  
  const meta = {
    title,
    createdAt: now,
    updatedAt: now,
    createdBy: session?.short || '不明',
    updatedBy: session?.short || '不明',
    type: currentWizardType,
    linkType: linkType
  };
  
  const blocks = {};
  let order = 0;
  
  const addB = (type, text) => {
    blocks[firebaseDb.ref().push().key] = { type, text, order: order++ };
  };
  
  addB('heading', title);
  
  if (currentWizardType === 'daily') {
    addB('area-header', '昨日やったこと');
    addB('bullet', '');
    addB('area-header', '今日やること');
    addB('bullet', '');
    addB('area-header', '困っていること / 相談');
    addB('bullet', '');
  } else if (currentWizardType === 'weekly') {
    addB('area-header', '進捗の共有');
    addB('bullet', '');
    addB('area-header', '今週の目標・タスク');
    addB('bullet', '');
  } else if (currentWizardType === '1on1') {
    addB('area-header', 'アジェンダ / 話したいこと');
    addB('bullet', '');
    addB('area-header', 'アクションアイテム');
    addB('bullet', '');
  } else {
    addB('text', '');
  }
  
  newRef.set({ meta, blocks }).then(() => {
    openCanvas(id);
    if (linkType === 'slack_canvas') {
      const channel = document.getElementById('wizard-slack-canvas-channel').value;
      let md = '';
      Object.values(blocks).sort((a,b)=>a.order-b.order).forEach(b => {
        if (b.type === 'heading') md += '# ' + b.text + '\n\n';
        else if (b.type === 'subheading') md += '## ' + b.text + '\n\n';
        else if (b.type === 'h3') md += '### ' + b.text + '\n\n';
        else if (b.type === 'area-header') md += '## ' + b.text + '\n\n';
        else if (b.type === 'task' || b.type === 'checkbox') md += '- [ ] ' + b.text + '\n';
        else if (b.type === 'bullet') md += '- ' + b.text + '\n';
        else md += b.text + '\n\n';
      });
      if (typeof toast === 'function') toast('Slack Canvasを作成中...');
      API.createSlackCanvas(title, md, channel).then(res => {
        if (res.success) {
          if (typeof toast === 'function') toast('Slack Canvasを作成しました');
        } else {
          if (typeof toast === 'function') toast('Slack Canvas作成失敗: ' + res.error);
        }
      }).catch(err => {
        console.error(err);
        if (typeof toast === 'function') toast('Slack Canvas作成エラー: ' + err.message);
      });
    }
  });
};

// =========================================
// SLASH COMMAND POPUP LOGIC
// =========================================
let slashPopupOpen = false;
let slashPopupCurrentIndex = -1;
let slashPopupTargetBlockKey = null;
let slashPopupTargetBlockIdx = -1;

window.showSlashPopup = function(el) {
  const popup = document.getElementById('slash-command-popup');
  if (!popup) return;
  
  const rect = el.getBoundingClientRect();
  popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  popup.style.left = (rect.left + window.scrollX) + 'px';
  popup.style.display = 'block';
  slashPopupOpen = true;
  slashPopupTargetBlockKey = el.dataset.key || el.parentElement?.dataset?.key;
  slashPopupTargetBlockIdx = parseInt(el.dataset.idx || el.parentElement?.dataset?.idx || '0');
  
  const text = el.textContent || '';
  const search = text.startsWith('/') ? text.slice(1).trim().toLowerCase() : '';
  
  const items = Array.from(popup.querySelectorAll('.slash-item'));
  let visibleCount = 0;
  
  items.forEach(item => {
    item.classList.remove('selected');
    const cmd = item.dataset.cmd;
    const txt = item.textContent.toLowerCase();
    if (!search || cmd.toLowerCase().includes(search) || txt.includes(search)) {
      item.style.display = 'flex';
      visibleCount++;
    } else {
      item.style.display = 'none';
    }
  });
  
  slashPopupCurrentIndex = -1;
  if (visibleCount > 0) {
    const firstVis = items.find(i => i.style.display !== 'none');
    if (firstVis) {
      firstVis.classList.add('selected');
      slashPopupCurrentIndex = items.indexOf(firstVis);
    }
  }
};

window.hideSlashPopup = function() {
  const popup = document.getElementById('slash-command-popup');
  if (popup) popup.style.display = 'none';
  slashPopupOpen = false;
  slashPopupCurrentIndex = -1;
  slashPopupTargetBlockKey = null;
  slashPopupTargetBlockIdx = -1;
};

window.executeSlashCommand = function(cmd) {
  const key = slashPopupTargetBlockKey;
  const idx = slashPopupTargetBlockIdx;
  hideSlashPopup();
  if (!key || !canvasCurrentId) return;
  const targetEl = document.querySelector(`[data-key="${key}"] .cb-text`) || document.querySelector(`[data-key="${key}"]`);
  
  if (targetEl) {
    targetEl.textContent = '';
    firebaseDb.ref(`canvases/${canvasCurrentId}/blocks/${key}/text`).set('');
  }
  
  if (cmd === '/task') {
    if (typeof showTaskModal === 'function') showTaskModal(idx);
    else if (typeof openAddTask === 'function') openAddTask();
  } else if (cmd === '/next') {
    if (typeof createFutureMeeting === 'function') createFutureMeeting();
  } else if (cmd === '/check') {
    convertBlock(key, 'checkbox', '');
  } else if (cmd === '/bullet') {
    convertBlock(key, 'bullet', '');
  } else if (cmd === '/h2') {
    convertBlock(key, 'heading', '');
  } else if (cmd === '/area') {
    convertBlock(key, 'area-header', '新しいエリア');
  } else if (cmd === '/toc') {
    convertBlock(key, 'toc', '');
  }
};

(function attachSlashPopupEvents() {
  const popup = document.getElementById('slash-command-popup');
  if (popup) {
    popup.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.slash-item');
      if (item) {
        e.preventDefault();
        executeSlashCommand(item.dataset.cmd);
      }
    });
  }
})();

window.scrollToBlock = function(key) {
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.5s';
    const oldBg = el.style.background;
    el.style.background = 'rgba(79,70,229,0.15)';
    setTimeout(() => {
      el.style.background = oldBg;
    }, 1500);
  }
};

// =========================================
// CANVAS GLOBAL SELECTION LOGIC (Ctrl+A)
// =========================================
document.addEventListener('keydown', (e) => {
  if (!canvasCurrentId) return; // Only active when a canvas is open

  // Ctrl+A / Cmd+A
  if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) {
    const active = document.activeElement;
    // If focused on an input outside the canvas (like search bar), ignore
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && !active.classList.contains('cb-text')) {
      return;
    }
    
    // If focused on a canvas block
    if (active && active.classList.contains('cb-text')) {
      const textLength = active.textContent.length;
      const selLength = window.getSelection().toString().length;
      // First Ctrl+A selects block text. Second Ctrl+A selects all blocks.
      if (textLength > 0 && selLength < textLength) {
        return; // Let browser do the first selection
      }
    }
    
    // Select all blocks
    e.preventDefault();
    const container = document.getElementById('canvas-blocks');
    if (container) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(container);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  
  // Backspace / Delete when multiple blocks are selected
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const container = document.getElementById('canvas-blocks');
      // Check if the selection is the entire container or spans multiple blocks
      if (range.commonAncestorContainer === container || range.commonAncestorContainer.id === 'canvas-blocks') {
        e.preventDefault();
        if (confirm('選択されているすべてのブロックを削除しますか？')) {
          firebaseDb.ref(`canvases/${canvasCurrentId}/blocks`).remove().then(() => {
            // Create a single empty block
            addBlock(0, 'text', '');
          });
        }
      }
    }
  }
});
