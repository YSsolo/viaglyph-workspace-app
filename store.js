// ═══ ViaGLYPH Workspace — Data Store ═══
const MEMBER={
  '山口':{bg:'#1e3d14',emoji:'🌿',text:'#86d56b'},
  '市川':{bg:'#3d2410',emoji:'🔥',text:'#e09060'},
  '村山':{bg:'#102040',emoji:'💎',text:'#6bafd4'},
  '全員':{bg:'#2a1f3d',emoji:'✨',text:'#c4b5fd'}
};
const TYPE_CONFIG={
  doc:{icon:'📝',color:'#1a73e8',label:'ドキュメント',bg:'linear-gradient(135deg,#0d2a5e,#1a3a7e)'},
  sheet:{icon:'📊',color:'#0f9d58',label:'スプレッドシート',bg:'linear-gradient(135deg,#0a3320,#0d5c33)'},
  slide:{icon:'📋',color:'#f4b400',label:'スライド',bg:'linear-gradient(135deg,#3d2800,#6b4000)'},
  folder:{icon:'📁',color:'#7289da',label:'フォルダ',bg:'linear-gradient(135deg,#1a1e3a,#252b55)'},
  pdf:{icon:'📃',color:'#db4437',label:'PDF',bg:'linear-gradient(135deg,#3a0a0a,#6b1010)'},
  other:{icon:'📎',color:'#9e9e9e',label:'その他',bg:'linear-gradient(135deg,#1a1a1a,#2a2a2a)'}
};
let ctx='dev', view='kanban';
// currentUser はログインセッションから取得
let currentUser = (function(){
  try {
    const s = localStorage.getItem('vg_session');
    return s ? JSON.parse(s).short : '山口';
  } catch { return '山口'; }
})();
let dailyDate=new Date().toISOString().slice(0,10);
const DATA={
  dev:{
    ganttTitle:'スプリントスケジュール（開発）',
    ganttHint:'開発モード: スプリント・マイルストーン・依存関係を管理',
    kanbanTitle:'Sprint Kanban',
    kanbanCols:['Backlog','Sprint','In Review','Done'],
    kanbanColors:['var(--muted)','var(--warn)','var(--a3)','var(--ok)'],
    tasks:[
      {id:1,title:'解法グラフ 全分野整備',status:'WIP',prio:'高',assign:'村山',due:'5/10',tags:['開発','未踏'],gantt:{start:0,len:6,col:'#4c1d95'},ctx:'dev'},
      {id:2,title:'スプリント2 開発着手',status:'WIP',prio:'高',assign:'村山',due:'5/18',tags:['開発','スプリント'],gantt:{start:0,len:10,col:'#1e3a5f'},ctx:'dev'},
      {id:3,title:'QLYPH フロントエンド完成',status:'WIP',prio:'高',assign:'村山',due:'5/31',tags:['開発','フロント'],gantt:{start:0,len:14,col:'#064e3b'},ctx:'dev'},
      {id:4,title:'認証バックエンド実装（Rails 8）',status:'TODO',prio:'中',assign:'村山',due:'6/6',tags:['開発','バックエンド'],gantt:{start:10,len:8,col:'#1e3a5f'},ctx:'dev'},
      {id:5,title:'SEE:D→カリキュラムマップ連動',status:'TODO',prio:'中',assign:'村山',due:'6/30',tags:['開発'],gantt:{start:14,len:7,col:'#7f1d1d'},ctx:'dev'},
      {id:6,title:'知識マップ著作権分離',status:'Blocked',prio:'高',assign:'村山',due:'随時',tags:['開発','法務'],gantt:{start:0,len:14,col:'#78350f'},ctx:'dev'}
    ],
    ganttGroups:[{label:'Sprint 2（〜5/18）',tasks:[1,2]},{label:'5月末目標',tasks:[3,6]},{label:'6月以降',tasks:[4,5]}]
  },
  biz:{
    ganttTitle:'チームタスクスケジュール（一般）',
    ganttHint:'一般モード: ミーティング・申請・チーム運営タスクを管理',
    kanbanTitle:'チームタスク',
    kanbanCols:['未着手','進行中','確認待ち','完了'],
    kanbanColors:['var(--muted)','var(--warn)','var(--a3)','var(--ok)'],
    tasks:[
      {id:10,title:'日報アプリ開発',status:'WIP',prio:'高',assign:'山口',due:'5/10',tags:['開発','社内'],gantt:{start:0,len:8,col:'#4c1d95'},ctx:'biz'},
      {id:11,title:'塾の生徒募集計画',status:'TODO',prio:'中',assign:'市川',due:'5/15',tags:['ビジネス','塾'],gantt:{start:0,len:10,col:'#1e3a5f'},ctx:'biz'},
      {id:12,title:'法律確認の結果共有',status:'Blocked',prio:'中',assign:'市川',due:'随時',tags:['法務'],gantt:{start:0,len:14,col:'#64748b'},ctx:'biz'},
      {id:13,title:'投資家向け資料作成',status:'TODO',prio:'高',assign:'山口',due:'5/20',tags:['ビジネス'],gantt:{start:4,len:8,col:'#7f1d1d'},ctx:'biz'},
      {id:14,title:'週次MTG議事録',status:'Done',prio:'中',assign:'全員',due:'5/3',tags:['定例'],gantt:{start:0,len:0,col:'#a21caf',mile:true},ctx:'biz'}
    ],
    ganttGroups:[{label:'🔴 今週',tasks:[10,11,12]},{label:'🟡 今月中',tasks:[13]},{label:'✅ 完了',tasks:[14]}]
  }
};

// ローカルストレージの同期済みタスクで初期状態を復元
try {
  const syncedTasks = JSON.parse(localStorage.getItem('vg_synced_tasks') || 'null');
  if (syncedTasks) {
    if (syncedTasks.dev) {
      DATA.dev.tasks = Array.isArray(syncedTasks.dev) ? syncedTasks.dev.filter(Boolean) : Object.values(syncedTasks.dev);
    }
    if (syncedTasks.biz) {
      DATA.biz.tasks = Array.isArray(syncedTasks.biz) ? syncedTasks.biz.filter(Boolean) : Object.values(syncedTasks.biz);
    }
  }
} catch (e) {}

let localTasks=JSON.parse(localStorage.getItem('vg_local_tasks')||'[]');
let workLogs=JSON.parse(localStorage.getItem('vg_work_logs')||'[]');
let dailyMemos=JSON.parse(localStorage.getItem('vg_daily_memos')||'{}');
let canvaDocs=JSON.parse(localStorage.getItem('vg_canvas_docs')||'null');
let goals=JSON.parse(localStorage.getItem('vg_goals')||'null');
if(!goals){
  goals=[
    {id:1,name:'ViaGLYPH',icon:'🧠',bigGoals:[
      {id:10,name:'未踏アドバンスト採択',midGoals:[
        {id:100,name:'申請書完成',tasks:[
          {id:1001,name:'知識グラフ設計書',done:false,assign:'村山'},
          {id:1002,name:'SEE:D連携仕様',done:false,assign:'村山'},
          {id:1003,name:'予算計画',done:true,assign:'市川'}
        ]},
        {id:101,name:'プロト開発',tasks:[
          {id:1004,name:'QLYPH フロントエンド',done:false,assign:'村山'},
          {id:1005,name:'認証バックエンド',done:false,assign:'村山'}
        ]}
      ]},
      {id:11,name:'Sprint 2 完走',midGoals:[
        {id:110,name:'開発目標',tasks:[
          {id:1010,name:'解法グラフ全分野整備',done:false,assign:'村山'},
          {id:1011,name:'スプリント2開発着手',done:false,assign:'村山'}
        ]}
      ]}
    ]},
    {id:2,name:'塾事業',icon:'📚',bigGoals:[
      {id:20,name:'生徒10名獲得',midGoals:[
        {id:200,name:'集客',tasks:[
          {id:2001,name:'募集計画策定',done:false,assign:'市川'},
          {id:2002,name:'チラシ作成',done:false,assign:'山口'}
        ]}
      ]}
    ]},
    {id:3,name:'社内基盤',icon:'⚙️',bigGoals:[
      {id:30,name:'チーム運用効率化',midGoals:[
        {id:300,name:'ツール整備',tasks:[
          {id:3001,name:'日報アプリ開発',done:false,assign:'山口'},
          {id:3002,name:'Discord Bot安定化',done:false,assign:'山口'}
        ]}
      ]}
    ]}
  ];
}
if(!canvaDocs){
  canvaDocs=[
    {id:1,type:'doc',title:'5/3 MTG議事録',url:'https://docs.google.com/document',tags:['議事録','定例'],note:'日報アプリ開発方針の議論',added:'2026-05-03'},
    {id:2,type:'doc',title:'未踏アドバンスト申請書',url:'https://docs.google.com/document',tags:['未踏','申請'],note:'知識グラフ＋知識解放グラフ',added:'2026-04-15'},
    {id:3,type:'sheet',title:'塾の収益モデル試算',url:'https://docs.google.com/spreadsheets',tags:['塾','ビジネス'],note:'VIP10万×5名=月50万',added:'2026-04-17'},
    {id:4,type:'slide',title:'ロードマップ プレゼン',url:'https://docs.google.com/presentation',tags:['ロードマップ'],note:'チーム共有用',added:'2026-04-10'}
  ];
}

try {
  window.DATA = DATA;
  Object.defineProperty(window, 'goals', {
    get: () => goals,
    set: (val) => { goals = val; },
    configurable: true
  });
  Object.defineProperty(window, 'workLogs', {
    get: () => workLogs,
    set: (val) => { workLogs = val; },
    configurable: true
  });
  Object.defineProperty(window, 'localTasks', {
    get: () => localTasks,
    set: (val) => { localTasks = val; },
    configurable: true
  });
  Object.defineProperty(window, 'dailyMemos', {
    get: () => dailyMemos,
    set: (val) => { dailyMemos = val; },
    configurable: true
  });
} catch(e) {}

// saveLocal: localStorage のみに保存（RTDBリスナー等の書き込みループ防止）
function saveLocal(){
  const g = (typeof window.goals !== 'undefined' && Array.isArray(window.goals)) ? window.goals : goals;
  if (typeof goals !== 'undefined') goals = g;
  localStorage.setItem('vg_local_tasks',JSON.stringify(localTasks));
  localStorage.setItem('vg_work_logs',JSON.stringify(workLogs));
  localStorage.setItem('vg_daily_memos',JSON.stringify(dailyMemos));
  localStorage.setItem('vg_canvas_docs',JSON.stringify(canvaDocs));
  localStorage.setItem('vg_goals',JSON.stringify(g));
}

// save: saveLocal + API書き込み (手動変更時用)
function save(){
  const g = (typeof window.goals !== 'undefined' && Array.isArray(window.goals)) ? window.goals : goals;
  if (typeof goals !== 'undefined') goals = g;
  saveLocal();
  if(typeof API!=='undefined'&&API.isOnline()){
    API.saveGoals(g).catch(()=>{});
  }
}

function getAllTasks(){
  return [...(DATA.dev?.tasks||[]), ...(DATA.biz?.tasks||[]), ...localTasks];
}
function findTask(id){
  return getAllTasks().find(t=>t.id===id);
}
function addWorkLog(taskId,minutes,tags,comment){
  const log={taskId,date:dailyDate,minutes,tags,comment,user:currentUser,createdAt:new Date().toISOString()};
  workLogs.push(log);
  window.workLogs = workLogs;
  saveLocal();
  if(typeof API!=='undefined'&&API.isOnline()){
    return API.addWorkLog(log).catch(()=>{});
  }
}
function getLogsForDate(date){
  const currentLogs = (typeof window.workLogs !== 'undefined' && Array.isArray(window.workLogs)) ? window.workLogs : workLogs;
  return currentLogs.filter(l=>l.date===date);
}
function toast(msg){
  const t=document.getElementById('toast');if(!t)return;t.textContent=msg;
  t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);
}
const statusMap={dev:{'Backlog':'TODO','Sprint':'WIP','In Review':'Review','Done':'Done'},biz:{'未着手':'TODO','進行中':'WIP','確認待ち':'Review','完了':'Done'}};
const statusRevMap={dev:{'TODO':'Backlog','WIP':'Sprint','Review':'In Review','Done':'Done'},biz:{'TODO':'未着手','WIP':'進行中','Review':'確認待ち','Done':'完了'}};
