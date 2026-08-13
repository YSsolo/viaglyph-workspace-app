// ═══ ViaGLYPH Workspace — Views (Mobile-first, Dailylog base) ═══

// ─── SECURITY HELPERS ───
function escH(s){
  if(typeof s!=='string') s=String(s||'');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── STOPWATCH ───
let swRunning=false, swStart=0, swElapsed=0, swInterval=null;
function toggleStopwatch(){
  const btn=document.getElementById('btn-sw-toggle');
  const icon=document.getElementById('sw-icon');
  const disp=document.getElementById('stopwatch-display');
  if(swRunning){
    swRunning=false; clearInterval(swInterval);
    swElapsed+=Date.now()-swStart;
    btn.classList.remove('running'); icon.textContent='▶';
    disp.classList.remove('running');
    document.getElementById('btn-use-sw').style.display='block';
  } else {
    swRunning=true; swStart=Date.now();
    btn.classList.add('running'); icon.textContent='⏸';
    disp.classList.add('running');
    swInterval=setInterval(updateSwDisplay,100);
  }
}
function resetStopwatch(){
  swRunning=false; clearInterval(swInterval); swElapsed=0; swStart=0;
  document.getElementById('stopwatch-display').textContent='00:00:00';
  document.getElementById('stopwatch-display').classList.remove('running');
  document.getElementById('btn-sw-toggle').classList.remove('running');
  document.getElementById('sw-icon').textContent='▶';
  document.getElementById('btn-use-sw').style.display='none';
}
function updateSwDisplay(){
  const total=swElapsed+(swRunning?Date.now()-swStart:0);
  const s=Math.floor(total/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  document.getElementById('stopwatch-display').textContent=
    String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function useStopwatchTime(){
  const total=swElapsed+(swRunning?Date.now()-swStart:0);
  const s=Math.floor(total/1000);
  document.getElementById('rec-hours').value=Math.floor(s/3600);
  document.getElementById('rec-minutes').value=Math.floor((s%3600)/60);
}
// ─── RECORD FORM ───
function populateTaskSelect(){
  const sel=document.getElementById('rec-task');
  if(!sel)return;
  const currVal = sel.value;
  const tasks=getAllTasks();
  let available = tasks.filter(t=>t.status!=='Done');
  if(!available.length) available = tasks;
  if (currVal && !available.some(t => String(t.id) === String(currVal))) {
    const selectedTask = tasks.find(t => String(t.id) === String(currVal));
    if (selectedTask) available.push(selectedTask);
  }
  const newHtml = '<option value="">-- タスクを選択 --</option>'+
    available.map(t=>`<option value="${parseInt(t.id)}">${escH(t.title)}</option>`).join('');
  if (sel.innerHTML !== newHtml) {
    sel.innerHTML = newHtml;
    if (currVal && Array.from(sel.options).some(o => String(o.value) === String(currVal))) {
      sel.value = currVal;
    }
  }
}
function submitRecord(e){
  e.preventDefault();
  const taskId=parseInt(document.getElementById('rec-task').value);
  const hours=parseInt(document.getElementById('rec-hours').value)||0;
  const mins=parseInt(document.getElementById('rec-minutes').value)||0;
  const totalMins=hours*60+mins;
  if(!taskId){toast('タスクを選択してください');return;}
  if(totalMins<=0){toast('作業時間を入力してください');return;}
  const selectedTags=Array.from(document.querySelectorAll('#quick-tags .tag.selected')).map(t=>t.dataset.tag);
  const comment=document.getElementById('rec-comment').value.trim();
  addWorkLog(taskId,totalMins,selectedTags,comment);
  document.getElementById('rec-hours').value=0;
  document.getElementById('rec-minutes').value=0;
  document.getElementById('rec-comment').value='';
  document.querySelectorAll('#quick-tags .tag').forEach(t=>t.classList.remove('selected'));
  resetStopwatch();
  toast('✅ 記録を保存しました！');
  renderTimeline();
}
const SEED_TASK_TITLES = {
  1: '解法グラフ 全分野整備', 2: 'スプリント2 開発着手', 3: 'QLYPH フロントエンド完成',
  4: '認証バックエンド実装（Rails 8）', 5: 'SEE:D→カリキュラムマップ連動', 6: '知識マップ著作権分離',
  10: '日報アプリ開発', 11: '塾の生徒募集計画', 12: '未踏アドバンスト申請書作成',
  13: '保護者面談ロードマップ作成', 14: 'VIPコースカリキュラム設計'
};
// ─── TIMELINE ───
function renderTimeline(){
  const currentLogs = (typeof window.workLogs !== 'undefined' && Array.isArray(window.workLogs)) ? window.workLogs : workLogs;
  const logs=currentLogs.slice().reverse().slice(0,100);
  const allTasks=getAllTasks();
  const list=document.getElementById('timeline-list');
  const empty=document.getElementById('timeline-empty');
  if(!list)return;
  if(!logs.length){list.innerHTML='';if(empty)empty.style.display='block';return;}
  if(empty)empty.style.display='none';
  list.innerHTML=logs.map(l=>{
    const task=allTasks.find(t=>String(t.id)===String(l.taskId));
    const title=task?.title || SEED_TASK_TITLES[l.taskId] || ('タスク#'+l.taskId);
    const h=Math.floor(l.minutes/60), m=l.minutes%60;
    return`<div class="record-card timeline-item"><div class="card-header"><div class="card-user"><span class="card-avatar">${MEMBER[l.user]?.emoji||'👤'}</span><span class="card-name">${escH(l.user)}</span></div><span class="card-time-ago">${escH(l.date)}</span></div><div class="card-project">${escH(title)}</div><div class="card-duration">${h}h ${m}m</div>${l.tags?.length?'<div class="card-tags">'+l.tags.map(t=>`<span class="card-tag">${escH(t)}</span>`).join('')+'</div>':''}${l.comment?'<div style="font-size:0.85rem;color:var(--text-secondary)">'+escH(l.comment)+'</div>':''}</div>`;
  }).join('');
}
// ─── KANBAN ───
let dragTaskId=null;
try {
  Object.defineProperty(window, 'dragTaskId', {
    get: () => dragTaskId,
    set: (val) => { dragTaskId = val; },
    configurable: true
  });
} catch(e) {}
function renderKanban(){
  const d=DATA[ctx];
  document.getElementById('kanban-title').textContent=d.kanbanTitle;
  const allTasks=getAllTasks();const board=document.getElementById('kanban-board');
  board.innerHTML=d.kanbanCols.map((col,i)=>{
    const sval=statusMap[ctx][col]||col;
    const cards=allTasks.filter(t=>t.status===sval||t.status===col);
    return`<div class="kcol" data-col="${escH(sval)}" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="onColDrop(event,'${escH(sval)}')"><div class="kcol-hd"><div class="kcol-dot" style="background:${d.kanbanColors[i]}"></div><span class="kcol-title">${escH(col)}</span><span class="kcnt">${cards.length}</span></div>${cards.map(t=>{
      const canDrag=t.assign===currentUser||t.assign==='全員';
      return`<div class="kcard${canDrag?'':' perm-no-drag'}" ${canDrag?'draggable="true"':''} data-id="${parseInt(t.id)}" ${canDrag?`ondragstart="onCardDragStart(event,${parseInt(t.id)})" ondragend="onCardDragEnd(event)"`:''}><div class="kcard-title">${escH(t.title)}</div><div class="kcard-meta">${(t.tags||[]).map(g=>`<span class="kcard-tag">${escH(g)}</span>`).join('')}<span class="kcard-avatar" title="${escH(t.assign)}">${MEMBER[t.assign]?.emoji||escH((t.assign&&t.assign[0])||'👤')}</span></div></div>`;
    }).join('')}<div class="kadd" onclick="openAddTask()">＋</div></div>`;
  }).join('');
  renderDaily();
}
function onCardDragStart(e,id){dragTaskId=id;setTimeout(()=>e.target.classList.add('dragging'),0);}
function onCardDragEnd(e){e.target.classList.remove('dragging');}
function onColDrop(e,toStatus){
  e.preventDefault();e.currentTarget.classList.remove('drag-over');
  if(dragTaskId===null)return;
  const task=findTask(dragTaskId);
  if(task){
    // 権限チェック: 自分のタスク or 全員のみ
    if(task.assign!==currentUser&&task.assign!=='全員'){
      toast('❌ 他のメンバーのタスクは移動できません');
      dragTaskId=null;return;
    }
    const old=task.status;task.status=toStatus;
    if(toStatus==='Done'&&old!=='Done'){
      addWorkLog(task.id,30,task.tags,'看板からDoneに移動');
      toast(`✅ "${task.title}" → 日報に反映`);
    }
    saveLocal();
    if(typeof API!=='undefined'&&API.isOnline()){
      API.updateTask(task.id,{status:toStatus},task.ctx).catch(()=>{});
    }
    renderAll();
  }
  dragTaskId=null;
}

// ─── DAILY ───
function renderDaily(){
  const allTasks=[...DATA.dev.tasks,...DATA.biz.tasks,...localTasks];
  const logs=getLogsForDate(dailyDate);
  const loggedIds=[...new Set(logs.map(l=>l.taskId))];
  const dd=new Date(dailyDate);
  const days=['日','月','火','水','木','金','土'];
  document.getElementById('daily-date-label').textContent=`${dd.getMonth()+1}/${dd.getDate()}（${days[dd.getDay()]}）`;
  const totalMin=logs.reduce((s,l)=>s+l.minutes,0);
  document.getElementById('daily-stat-time').textContent=`${Math.floor(totalMin/60)}h ${totalMin%60}m`;
  document.getElementById('daily-stat-tasks').textContent=loggedIds.length+'件';
  document.getElementById('daily-stat-done').textContent=allTasks.filter(t=>t.status==='Done').length+'件';
  const doneEl=document.getElementById('daily-done-list');
  if(!loggedIds.length){
    doneEl.innerHTML='<div class="daily-empty">看板でタスクをDoneに移動、<br>または「記録」タブで追加</div>';
  } else {
    doneEl.innerHTML=loggedIds.map(tid=>{
      const task=allTasks.find(t=>t.id===tid);
      const tl=logs.filter(l=>l.taskId===tid);
      const m=tl.reduce((s,l)=>s+l.minutes,0);
      const tags=tl.flatMap(l=>l.tags||[]);
      return`<div class="daily-task-item"><div class="daily-task-icon">${task?.status==='Done'?'✅':'🔄'}</div><div class="daily-task-info"><div class="daily-task-title">${escH(task?.title||'#'+tid)}</div><div class="daily-task-meta"><span>⏱ ${Math.floor(m/60)}h${m%60}m</span>${tags.length?'<span>'+tags.map(t=>escH(t)).join(', ')+'</span>':''}</div></div></div>`;
    }).join('');
  }
  const todoTasks=allTasks.filter(t=>t.status==='TODO'||t.status==='WIP').slice(0,5);
  document.getElementById('daily-tomorrow-list').innerHTML=todoTasks.map(t=>`<div class="daily-suggestion"><span class="bullet">○</span><span style="flex:1">${escH(t.title)}</span></div>`).join('')||'<div style="font-size:0.8rem;color:var(--text-secondary);padding:8px">なし 🎉</div>';
  const memoEl = document.getElementById('daily-memo');
  if (memoEl && document.activeElement !== memoEl) {
    const currentMemos = (typeof window.dailyMemos !== 'undefined') ? window.dailyMemos : dailyMemos;
    memoEl.value = currentMemos[dailyDate] || '';
  }
}
function saveDailyMemo(){
  const currentMemos = (typeof window.dailyMemos !== 'undefined') ? window.dailyMemos : dailyMemos;
  const memoVal = document.getElementById('daily-memo').value;
  currentMemos[dailyDate] = memoVal;
  if (typeof dailyMemos !== 'undefined') {
    dailyMemos[dailyDate] = memoVal;
  }
  saveLocal();
  if(typeof API!=='undefined'&&API.isOnline()){
    API.saveDailyMemo(dailyDate,currentUser,memoVal).catch(()=>{});
  }
}
function shiftDaily(d){const dt=new Date(dailyDate);dt.setDate(dt.getDate()+d);dailyDate=dt.toISOString().slice(0,10);renderDaily();}
function exportDaily(fmt){
  const allTasks=[...DATA.dev.tasks,...DATA.biz.tasks,...localTasks];
  const logs=getLogsForDate(dailyDate);const ids=[...new Set(logs.map(l=>l.taskId))];
  const dd=new Date(dailyDate);const days=['日','月','火','水','木','金','土'];
  let md=`# 日報 ${dd.getMonth()+1}/${dd.getDate()}（${days[dd.getDay()]}）\n\n## やったこと\n`;
  ids.forEach(tid=>{const t=allTasks.find(x=>x.id===tid);const m=logs.filter(l=>l.taskId===tid).reduce((s,l)=>s+l.minutes,0);md+=`- ${t?.status==='Done'?'✅':'🔄'} ${t?.title||'#'+tid}（${Math.floor(m/60)}h${m%60}m）\n`;});
  if(!ids.length)md+='- なし\n';
  md+='\n## 明日やること\n';
  allTasks.filter(t=>t.status==='TODO'||t.status==='WIP').slice(0,5).forEach(t=>{md+=`- ${t.title}\n`;});
  const memo=dailyMemos[dailyDate]||'';if(memo)md+=`\n## メモ\n${memo}\n`;
  if(fmt==='clipboard'){navigator.clipboard.writeText(md).then(()=>toast('📋 コピーしました'));return;}
  toast('🎮 Discord投稿機能は設定画面から');
}
// ─── MEMBERS ───
const MEMBERS_DATA=[
  {name:'山口 慧',short:'山口',role:'エンジニア',emoji:'🌿',bg:'#dcfce7',statusKey:'yamaguchi'},
  {name:'市川 翔大',short:'市川',role:'CEO / ビジネス',emoji:'🔥',bg:'#fef3c7',statusKey:'ichikawa'},
  {name:'村山 貴志',short:'村山',role:'テックリード',emoji:'💎',bg:'#dbeafe',statusKey:'murayama'}
];
let memberStatuses=JSON.parse(localStorage.getItem('vg_member_status')||'{}');
if(!memberStatuses.yamaguchi)memberStatuses={yamaguchi:'online',ichikawa:'away',murayama:'online'};
try {
  Object.defineProperty(window, 'memberStatuses', {
    get: () => memberStatuses,
    set: (val) => { memberStatuses = val; },
    configurable: true
  });
} catch(e) {}
function saveMemberStatuses(){localStorage.setItem('vg_member_status',JSON.stringify(memberStatuses));}
function cycleMemberStatus(key){
  // 権限: 自分のステータスのみ変更可
  const member=MEMBERS_DATA.find(m=>m.statusKey===key);
  if(member&&member.short!==currentUser){toast('❌ 他のメンバーのステータスは変更できません');return;}
  const order=['online','away','offline'];
  const i=order.indexOf(memberStatuses[key]||'offline');
  memberStatuses[key]=order[(i+1)%3];
  saveMemberStatuses();renderMembers();
  if(typeof API!=='undefined'&&API.isOnline()){
    API.updateMemberStatus(member.short,memberStatuses[key]).catch(()=>{});
  }
}
let taskPickerMember=null;
function openTaskPicker(memberShort){
  taskPickerMember=memberShort;
  const allTasks=[...DATA.dev.tasks,...DATA.biz.tasks,...localTasks];
  document.getElementById('task-picker-member').textContent=memberShort+'のタスク（タップで取組中に追加/解除）';
  const myTasks=allTasks.filter(t=>t.assign===memberShort&&t.status!=='Done');
  const list=document.getElementById('task-picker-list');
  list.innerHTML=myTasks.map(t=>{
    const isWip=t.status==='WIP';
    return`<div style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid ${isWip?'var(--data-01)':'var(--neutral-border)'};border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;background:${isWip?'#EBF8FF':'var(--surface)'};transition:var(--transition)" onclick="toggleMemberTask('${escH(memberShort)}',${parseInt(t.id)})"><div style="width:20px;height:20px;border-radius:4px;border:2px solid ${isWip?'var(--data-01)':'var(--neutral-border)'};display:flex;align-items:center;justify-content:center;font-size:0.7rem;flex-shrink:0;background:${isWip?'var(--data-01)':'transparent'};color:#fff">${isWip?'✓':''}</div><span style="flex:1;font-size:0.85rem;font-weight:${isWip?'600':'400'}">${escH(t.title)}</span>${isWip?'<span style="font-size:0.65rem;color:var(--data-01);font-weight:600;padding:2px 6px;background:#EBF8FF;border-radius:4px">取組中</span>':''}</div>`;
  }).join('')||'<div class="daily-empty">担当タスクがありません</div>';
  document.getElementById('task-picker-modal').classList.add('open');
}
function closeTaskPicker(){document.getElementById('task-picker-modal').classList.remove('open');renderMembers();renderKanban();}
function toggleMemberTask(memberShort,taskId){
  const allTasks=[...DATA.dev.tasks,...DATA.biz.tasks,...localTasks];
  const task=allTasks.find(t=>t.id===taskId);
  if(task){
    task.status=task.status==='WIP'?'TODO':'WIP';
    saveLocal();
    if(typeof API!=='undefined'&&API.isOnline()){
      API.updateTask(task.id,{status:task.status},task.ctx).catch(()=>{});
    }
    openTaskPicker(memberShort); // re-render picker
  }
}
function renderMembers(){
  const allTasks=[...DATA.dev.tasks,...DATA.biz.tasks,...localTasks];
  const today=new Date().toISOString().slice(0,10);
  const todayLogs=workLogs.filter(l=>l.date===today);
  const statusLabels={online:'出勤中',away:'離席中',offline:'オフライン'};
  const statusColors={online:'var(--data-03)',away:'var(--data-02)',offline:'#9ca3af'};
  const el=document.getElementById('member-list');
  el.innerHTML='<div class="member-list">'+MEMBERS_DATA.map(m=>{
    const st=memberStatuses[m.statusKey]||'offline';
    const wipTasks=allTasks.filter(t=>t.assign===m.short&&t.status==='WIP');
    const memberLogs=todayLogs.filter(l=>l.user===m.short);
    const totalMin=memberLogs.reduce((s,l)=>s+l.minutes,0);
    const taskCount=new Set(memberLogs.map(l=>l.taskId)).size;
    const h=Math.floor(totalMin/60),min=totalMin%60;
    const barPct=Math.min((totalMin/480)*100,100);
    return`<div class="member-card">
      <div class="member-card-header">
        <div class="member-avatar" style="background:${m.bg}">${m.emoji}<div class="member-status-dot ${st}"></div></div>
        <div class="member-info"><div class="member-name">${m.name}</div><div class="member-role">${m.role}</div></div>
        <button class="member-status-label ${st}" onclick="cycleMemberStatus('${m.statusKey}')" title="タップで切替">${statusLabels[st]}</button>
      </div>
      ${wipTasks.length?wipTasks.map(t=>`<div class="member-current"><div class="member-current-label">🔨 取組中</div><div class="member-current-task">${t.title}</div>${t.tags.map(g=>`<span class="member-current-tag">${g}</span>`).join(' ')}</div>`).join(''):`<div class="member-current"><div class="member-current-label">取組中タスク</div><div style="font-size:0.8rem;color:var(--text-secondary)">なし</div></div>`}
      ${m.short===currentUser?`<button class="btn-secondary" style="font-size:0.75rem;padding:8px;margin-bottom:8px" onclick="openTaskPicker('${m.short}')">＋ 取組中タスクを追加・変更</button>`:''}
      <div class="member-stats">
        <div class="member-stat"><div class="member-stat-value" style="color:${statusColors[st]}">${h}h ${min}m</div><div class="member-stat-label">今日の稼働</div></div>
        <div class="member-stat"><div class="member-stat-value">${taskCount}</div><div class="member-stat-label">記録タスク</div></div>
        <div class="member-stat"><div class="member-stat-value">${wipTasks.length}</div><div class="member-stat-label">進行中</div></div>
      </div>
      <div class="member-workbar"><div class="member-workbar-fill" style="width:${barPct}%;background:${statusColors[st]}"></div></div>
    </div>`;
  }).join('')+'</div>';
}
// ─── GOALS ───
const GOAL_STATUS={pending:{label:'未着手',color:'#9ca3af',bg:'#f3f4f6'},active:{label:'取組中',color:'var(--data-01)',bg:'#dbeafe'},delayed:{label:'遅延',color:'var(--data-05)',bg:'#fef2f2'},done:{label:'完了',color:'var(--data-03)',bg:'#dcfce7'}};
let goalAddType='project', goalAddParent=null;
function renderGoals(){
  const el=document.getElementById('goals-tree');
  if(!el)return;
  const currentGoals = (typeof window.goals !== 'undefined' && Array.isArray(window.goals)) ? window.goals : goals;
  el.innerHTML=currentGoals.map(proj=>{
    const bigs = proj.bigGoals || [];
    const totalTasks=bigs.reduce((s,bg)=>s+(bg.midGoals||[]).reduce((s2,mg)=>s2+(mg.tasks||[]).length,0),0);
    const doneTasks=bigs.reduce((s,bg)=>s+(bg.midGoals||[]).reduce((s2,mg)=>s2+(mg.tasks||[]).filter(t=>t.done).length,0),0);
    const pct=totalTasks?Math.round((doneTasks/totalTasks)*100):0;
    const ps=GOAL_STATUS[proj.status||'active']||GOAL_STATUS.active;
    return`<div class="goal-project open">
      <div class="goal-project-header" onclick="this.closest('.goal-project').classList.toggle('open')">
        <span class="goal-project-icon">${proj.icon || '📁'}</span>
        <span class="goal-project-name">${proj.name}</span>
        <span style="font-size:0.65rem;padding:2px 8px;border-radius:var(--radius-full);background:${ps.bg};color:${ps.color};font-weight:600">${ps.label}</span>
        <span class="goal-project-count">${doneTasks}/${totalTasks}</span>
        <span class="goal-project-arrow">▶</span>
      </div>
      <div class="goal-project-body">
        <div class="goal-progress" style="margin-bottom:12px;height:6px"><div class="goal-progress-fill" style="width:${pct}%;background:var(--data-01)"></div></div>
        ${proj.assignees?.length?'<div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:8px">👥 '+proj.assignees.join(', ')+(proj.due?' · 📅 '+proj.due:'')+'</div>':''}
        ${bigs.map(bg=>{
          const bs=GOAL_STATUS[bg.status||'active']||GOAL_STATUS.active;
          const mids = bg.midGoals || [];
          const bgTotal=mids.reduce((s,mg)=>s+(mg.tasks||[]).length,0);
          const bgDone=mids.reduce((s,mg)=>s+(mg.tasks||[]).filter(t=>t.done).length,0);
          return`<div class="goal-big open">
            <div class="goal-big-header" onclick="this.closest('.goal-big').classList.toggle('open')">
              <span class="goal-big-toggle">▶</span>
              <span class="goal-big-title">🎯 ${bg.name}</span>
              <span style="font-size:0.6rem;padding:2px 6px;border-radius:var(--radius-full);background:${bs.bg};color:${bs.color};font-weight:600">${bs.label}</span>
              <span style="font-size:0.7rem;color:var(--text-secondary)">${bgDone}/${bgTotal}</span>
            </div>
            <div class="goal-big-body">
              ${bg.assignees?.length?'<div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px">👥 '+bg.assignees.join(', ')+(bg.due?' · 📅 '+bg.due:'')+'</div>':''}
              ${mids.map(mg=>{
                const ms=GOAL_STATUS[mg.status||'active']||GOAL_STATUS.active;
                const ts = mg.tasks || [];
                return`<div class="goal-mid open">
                  <div class="goal-mid-header" onclick="this.closest('.goal-mid').classList.toggle('open')">
                    <span class="goal-mid-toggle">▶</span>
                    <span class="goal-mid-title">📌 ${mg.name}</span>
                    <span style="font-size:0.6rem;padding:1px 6px;border-radius:var(--radius-full);background:${ms.bg};color:${ms.color};font-weight:600;margin-left:6px">${ms.label}</span>
                  </div>
                  <div class="goal-mid-body">
                    ${mg.assignees?.length?'<div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px">👥 '+mg.assignees.join(', ')+(mg.due?' · 📅 '+mg.due:'')+'</div>':''}
                    ${ts.map(t=>`<div class="goal-task-item">
                      <div class="goal-task-check ${t.done?'done':''}" onclick="event.stopPropagation(); toggleGoalTask(${proj.id},${bg.id},${mg.id},${t.id})">${t.done?'✓':''}</div>
                      <span class="goal-task-name ${t.done?'done':''}">${t.name}</span>
                      <span class="goal-task-assign">${Array.isArray(t.assign)?t.assign.join(', '):t.assign}${t.due?' · '+t.due:''}</span>
                    </div>`).join('')}
                    <button class="goal-add-btn" onclick="event.stopPropagation(); openGoalModal('task',${proj.id},${bg.id},${mg.id})">＋ タスク追加</button>
                  </div>
                </div>`;
              }).join('')}
              <button class="goal-add-btn" onclick="event.stopPropagation(); openGoalModal('mid',${proj.id},${bg.id})">＋ 中目標追加</button>
            </div>
          </div>`;
        }).join('')}
        <button class="goal-add-btn" onclick="event.stopPropagation(); openGoalModal('big',${proj.id})">＋ 大目標追加</button>
      </div>
    </div>`;
  }).join('');
}
// ─── PROJECT PAGE ───
let currentProjectId=null;
function openProjectPage(projId){
  currentProjectId=projId;
  const currentGoals = (typeof window.goals !== 'undefined' && Array.isArray(window.goals)) ? window.goals : goals;
  const proj=currentGoals.find(p=>String(p.id)===String(projId));if(!proj)return;
  document.getElementById('project-page-title').textContent=proj.icon+' '+proj.name;
  const bigs = proj.bigGoals || [];
  const totalTasks=bigs.reduce((s,bg)=>s+(bg.midGoals||[]).reduce((s2,mg)=>s2+(mg.tasks||[]).length,0),0);
  const doneTasks=bigs.reduce((s,bg)=>s+(bg.midGoals||[]).reduce((s2,mg)=>s2+(mg.tasks||[]).filter(t=>t.done).length,0),0);
  const wipTasks=bigs.reduce((s,bg)=>s+(bg.midGoals||[]).reduce((s2,mg)=>s2+(mg.tasks||[]).filter(t=>!t.done).length,0),0);
  const pct=totalTasks?Math.round((doneTasks/totalTasks)*100):0;
  const ps=GOAL_STATUS[proj.status||'active']||GOAL_STATUS.active;
  const body=document.getElementById('project-page-body');
  body.innerHTML=`
    <div class="project-page-stats">
      <div class="project-page-stat"><div class="project-page-stat-value" style="color:${ps.color}">${ps.label}</div><div class="project-page-stat-label">ステータス</div></div>
      <div class="project-page-stat"><div class="project-page-stat-value">${pct}%</div><div class="project-page-stat-label">進捗</div></div>
      <div class="project-page-stat"><div class="project-page-stat-value" style="color:var(--data-03)">${doneTasks}</div><div class="project-page-stat-label">完了</div></div>
      <div class="project-page-stat"><div class="project-page-stat-value" style="color:var(--data-02)">${wipTasks}</div><div class="project-page-stat-label">残り</div></div>
    </div>
    ${proj.assignees?.length?'<div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px">👥 '+proj.assignees.join(', ')+(proj.due?' · 📅 期限: '+proj.due:'')+'</div>':''}
    <div class="goal-progress" style="margin-bottom:16px;height:6px"><div class="goal-progress-fill" style="width:${pct}%;background:var(--data-01)"></div></div>
    ${bigs.map(bg=>{
      const bs=GOAL_STATUS[bg.status||'active']||GOAL_STATUS.active;
      const mids = bg.midGoals || [];
      const bgTotal=mids.reduce((s,mg)=>s+(mg.tasks||[]).length,0);
      const bgDone=mids.reduce((s,mg)=>s+(mg.tasks||[]).filter(t=>t.done).length,0);
      return`<div class="goal-big open">
        <div class="goal-big-header" onclick="this.closest('.goal-big').classList.toggle('open')">
          <span class="goal-big-title">🎯 ${bg.name}</span>
          <span style="font-size:0.6rem;padding:2px 6px;border-radius:var(--radius-full);background:${bs.bg};color:${bs.color};font-weight:600">${bs.label}</span>
          <span style="font-size:0.7rem;color:var(--text-secondary)">${bgDone}/${bgTotal}</span>
          <span class="goal-big-toggle">▶</span>
        </div>
        <div class="goal-big-body">
          ${bg.assignees?.length?'<div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px">👥 '+bg.assignees.join(', ')+(bg.due?' · 📅 '+bg.due:'')+'</div>':''}
          ${mids.map(mg=>{
            const ms=GOAL_STATUS[mg.status||'active']||GOAL_STATUS.active;
            const ts = mg.tasks || [];
            return`<div class="goal-mid open">
              <div class="goal-mid-title" onclick="this.closest('.goal-mid').classList.toggle('open')">
                <span>📌 ${mg.name}</span>
                <span style="font-size:0.6rem;padding:1px 6px;border-radius:var(--radius-full);background:${ms.bg};color:${ms.color};font-weight:600;margin-left:6px">${ms.label}</span>
              </div>
              <div class="goal-mid-body">
                ${mg.assignees?.length?'<div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:4px">👥 '+mg.assignees.join(', ')+(mg.due?' · 📅 '+mg.due:'')+'</div>':''}
                ${ts.map(t=>`<div class="goal-task-item"><div class="goal-task-check ${t.done?'done':''}" onclick="toggleGoalTaskInPage(${proj.id},${bg.id},${mg.id},${t.id})">${t.done?'✓':''}</div><span class="goal-task-name ${t.done?'done':''}">${t.name}</span><span class="goal-task-assign">${Array.isArray(t.assign)?t.assign.join(', '):t.assign}${t.due?' · '+t.due:''}</span></div>`).join('')}
                <button class="goal-add-btn" onclick="openGoalModal('task',${proj.id},${bg.id},${mg.id})">＋ タスク追加</button>
              </div>
            </div>`;
          }).join('')}
          <button class="goal-add-btn" onclick="openGoalModal('mid',${proj.id},${bg.id})">＋ 中目標追加</button>
        </div>
      </div>`;
    }).join('')}
    <button class="goal-add-btn" onclick="openGoalModal('big',${proj.id})">＋ 大目標追加</button>
  `;
  document.getElementById('project-page').classList.add('open');
}
function closeProjectPage(){document.getElementById('project-page').classList.remove('open');renderGoals();}
function toggleGoalTaskInPage(projId,bigId,midId,taskId){
  const currentGoals = (typeof window.goals !== 'undefined' && Array.isArray(window.goals)) ? window.goals : goals;
  const proj=currentGoals.find(p=>String(p.id)===String(projId));
  const bg=proj?.bigGoals?.find(b=>String(b.id)===String(bigId));
  const mg=bg?.midGoals?.find(m=>String(m.id)===String(midId));
  const task=mg?.tasks?.find(t=>String(t.id)===String(taskId));
  if(task){
    task.done=!task.done;
    window.goals = currentGoals;
    if (typeof goals !== 'undefined') goals = currentGoals;
    save();
    openProjectPage(projId);
  }
}
function toggleGoalTask(projId,bigId,midId,taskId){
  const currentGoals = (typeof window.goals !== 'undefined' && Array.isArray(window.goals)) ? window.goals : goals;
  const proj=currentGoals.find(p=>String(p.id)===String(projId));
  const bg=proj?.bigGoals?.find(b=>String(b.id)===String(bigId));
  const mg=bg?.midGoals?.find(m=>String(m.id)===String(midId));
  const task=mg?.tasks?.find(t=>String(t.id)===String(taskId));
  if(task){
    task.done=!task.done;
    window.goals = currentGoals;
    if (typeof goals !== 'undefined') goals = currentGoals;
    save();
    renderGoals();
  }
}
function openGoalModal(type,projId,bigId,midId){
  goalAddType=type;goalAddParent={projId,bigId,midId};
  const titles={project:'プロジェクトを追加',big:'大目標を追加',mid:'中目標を追加',task:'タスクを追加'};
  document.getElementById('goal-modal-title').textContent=titles[type];
  document.getElementById('goal-name').value='';
  document.querySelectorAll('#goal-assign-tags .tag').forEach(t=>t.classList.remove('selected'));
  document.getElementById('goal-due').value='';
  document.getElementById('goal-status').value='active';
  document.getElementById('goal-modal').classList.add('open');
}
function closeGoalModal(){document.getElementById('goal-modal').classList.remove('open');}
function addGoalItem(){
  const name=document.getElementById('goal-name').value.trim();if(!name)return;
  const id=Date.now();
  const assignees=Array.from(document.querySelectorAll('#goal-assign-tags .tag.selected')).map(t=>t.dataset.member);
  const due=document.getElementById('goal-due').value||'';
  const status=document.getElementById('goal-status').value;
  const item = {id,name,icon:'📁',status,assignees,due,bigGoals:[]};
  if(goalAddType==='project'){
    goals.push(item);
    if(typeof window.goals !== 'undefined' && Array.isArray(window.goals) && window.goals !== goals){
      window.goals.push(item);
    }
  }
  else if(goalAddType==='big'){const p=goals.find(x=>x.id===goalAddParent.projId);if(p)p.bigGoals.push({id,name,status,assignees,due,midGoals:[]});}
  else if(goalAddType==='mid'){const p=goals.find(x=>x.id===goalAddParent.projId);const b=p?.bigGoals.find(x=>x.id===goalAddParent.bigId);if(b)b.midGoals.push({id,name,status,assignees,due,tasks:[]});}
  else if(goalAddType==='task'){const p=goals.find(x=>x.id===goalAddParent.projId);const b=p?.bigGoals.find(x=>x.id===goalAddParent.bigId);const m=b?.midGoals.find(x=>x.id===goalAddParent.midId);if(m)m.tasks.push({id,name,done:status==='done',assign:assignees.length?assignees:[currentUser],due});}
  save();closeGoalModal();renderGoals();toast('✅ 追加しました');
}
// ─── NAVIGATION ───
function setCtx(c){
  ctx=c;document.querySelectorAll('.ctx-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('ctx-'+c).classList.add('active');renderAll();
}
function setView(v){
  document.querySelectorAll('.view').forEach(p=>p.classList.remove('active'));
  document.getElementById('view-'+v).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${v}"]`)?.classList.add('active');
  if(v==='kanban'){renderKanban();renderDaily();}
  if(v==='members')renderMembers();
  if(v==='goals')renderGoals();
  if(v==='canvas' && typeof initCanvas==='function') initCanvas();
  if(v!=='canvas' && typeof closeCanvas==='function' && canvasCurrentId) closeCanvas();
  if(v==='record'){
    if(typeof API!=='undefined'&&API.isOnline()){API.syncAll();}
    populateTaskSelect();
    renderTimeline();
  }
}
function renderAll(){renderKanban();renderMembers();}
// ─── MODAL ───
function openAddTask(){document.getElementById('modal').classList.add('open');}
function closeModal(){document.getElementById('modal').classList.remove('open');}
function addTask(){
  const title=document.getElementById('m-title').value.trim();if(!title)return;
  const newTask={id:Date.now(),title,status:document.getElementById('m-status').value,prio:document.getElementById('m-prio').value,assign:document.getElementById('m-assign').value,due:document.getElementById('m-due').value||'随時',tags:document.getElementById('m-tag').value.split(',').map(s=>s.trim()).filter(Boolean),gantt:{start:5,len:7,col:'#6366f1'},ctx};
  localTasks.push(newTask);
  saveLocal();
  if(typeof API!=='undefined'&&API.isOnline()){
    API.addTask(newTask).catch(()=>{});
  }
  closeModal();document.getElementById('m-title').value='';document.getElementById('m-tag').value='';renderAll();toast('✅ タスク追加');
}
let toastTimer = null;

function hideToast() {
  const t = document.getElementById('toast');
  if (t) {
    t.classList.remove('show');
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}
window.hideToast = hideToast;

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  hideToast();
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    toastTimer = null;
  }, 2500);
}
// ─── LOGIN ───
async function handleLogin(e){
  e.preventDefault();
  const email=document.getElementById('login-email').value.trim();
  const password=document.getElementById('login-password').value;
  const errEl=document.getElementById('login-error');
  const btn=document.getElementById('login-btn');
  btn.textContent='ログイン中...';btn.disabled=true;
  errEl.style.display='none';
  const res=await API.login(email,password);
  if(res.success){
    currentUser=res.user.short;
    document.getElementById('user-display').textContent=res.user.emoji+' '+res.user.short;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').style.display='flex';
    renderAll();
    if(API.isOnline()){
      API.initRealtimeListeners();
      API.syncAll().then(()=>renderAll()).catch(()=>{});
    }
  } else {
    errEl.textContent=res.error;errEl.style.display='block';
  }
  btn.textContent='ログイン';btn.disabled=false;
}
// ─── INIT ───
document.addEventListener('DOMContentLoaded',async()=>{
  // ログインチェック
  if(API.isLoggedIn()){
    const session=API.getSession();
    currentUser=session.short;
    document.getElementById('user-display').textContent=session.emoji+' '+session.short;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').style.display='flex';
  } else {
    document.getElementById('app').style.display='none';
  }

  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click',()=>setView(btn.dataset.view));
  });
  document.getElementById('modal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal();});
  document.getElementById('task-picker-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeTaskPicker();});
  document.getElementById('goal-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeGoalModal();});
  document.getElementById('daily-memo')?.addEventListener('input',saveDailyMemo);
  document.querySelectorAll('#quick-tags .tag').forEach(t=>{
    t.addEventListener('click',()=>t.classList.toggle('selected'));
  });
  if(API.isLoggedIn()){
    renderAll();
    loadSettings();
    if(API.isOnline()){
      API.initRealtimeListeners();
      API.syncAll().then(()=>renderAll()).catch(()=>{});
    }
  }
});

// ─── SETTINGS ───
function saveSettings() {
  const settings = {
    slackWebhook: document.getElementById('setting-slack-webhook')?.value || '',
    slackMethod: document.querySelector('input[name="slack-method"]:checked')?.value || 'webhook',
    slackChannel: document.getElementById('setting-slack-channel')?.value || '',
    discordWebhook: document.getElementById('setting-discord-webhook')?.value || '',
    notifyStandup: document.getElementById('notify-standup')?.checked ?? true,
    notifyTaskDone: document.getElementById('notify-task-done')?.checked ?? true,
    notifyDaily: document.getElementById('notify-daily')?.checked ?? true,
    notifyCanvas: document.getElementById('notify-canvas')?.checked ?? false,
    autoSync: document.getElementById('setting-auto-sync')?.checked ?? true,
    sound: document.getElementById('setting-sound')?.checked ?? false
  };
  localStorage.setItem('vg_settings', JSON.stringify(settings));
}

function loadSettings() {
  const raw = localStorage.getItem('vg_settings');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    const set = (id, val) => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val || ''; }};
    set('setting-slack-webhook', s.slackWebhook);
    const methodRadio = document.querySelector(`input[name="slack-method"][value="${s.slackMethod || 'webhook'}"]`);
    if (methodRadio) methodRadio.checked = true;
    set('setting-slack-channel', s.slackChannel);
    set('setting-discord-webhook', s.discordWebhook);
    set('notify-standup', s.notifyStandup);
    set('notify-task-done', s.notifyTaskDone);
    set('notify-daily', s.notifyDaily);
    set('notify-canvas', s.notifyCanvas);
    set('setting-auto-sync', s.autoSync);
    set('setting-sound', s.sound);
  } catch (e) {}
}

function getSettings() {
  const raw = localStorage.getItem('vg_settings');
  return raw ? JSON.parse(raw) : {};
}

async function testSlackWebhook() {
  const method = document.querySelector('input[name="slack-method"]:checked')?.value || 'webhook';
  const resultEl = document.getElementById('slack-test-result');
  resultEl.textContent = '送信中...';

  if (method === 'bot') {
    const channel = document.getElementById('setting-slack-channel')?.value?.trim();
    if (!channel) { resultEl.textContent = '❌ チャンネルを入力してください'; return; }
    try {
      const res = await API.sendSlackMessage(channel, { text: '✅ ViaGLYPH Botからのテスト送信です！' });
      if (res && res.success && res.response && res.response.ok) {
        resultEl.textContent = '✅ 送信しました（Slackを確認してください）';
        toast('✅ Slackテスト送信完了');
      } else {
        resultEl.textContent = '❌ 送信失敗: ' + (res?.response?.error || res?.error || '不明なエラー');
      }
    } catch (e) {
      resultEl.textContent = '❌ ネットワークエラー';
    }
    return;
  }
}

async function testDiscordWebhook() {
  const url = document.getElementById('setting-discord-webhook')?.value?.trim();
  const resultEl = document.getElementById('discord-test-result');
  if (!url) { resultEl.textContent = '❌ URLを入力してください'; return; }
  // SSRF防止: Discord Webhook URLのみ許可
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('discord.com') || !parsed.pathname.startsWith('/api/webhooks/')) {
      resultEl.textContent = '❌ 有効なDiscord Webhook URLを入力してください（https://discord.com/api/webhooks/...）';
      return;
    }
  } catch { resultEl.textContent = '❌ 無効なURLです'; return; }
  resultEl.textContent = '送信中...';
  try {
    const session = API.getSession();
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🧠 **ViaGLYPH テスト通知**\n${escH(session?.name || 'ユーザー')}からのテスト送信です。` })
    });
    resultEl.textContent = '✅ 送信しました';
    toast('✅ Discordテスト送信完了');
  } catch (e) {
    resultEl.textContent = '❌ 送信失敗';
  }
}
