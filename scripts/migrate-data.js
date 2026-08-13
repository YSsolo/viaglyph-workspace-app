/**
 * ═══ ViaGLYPH Workspace — Data Migration Script ═══
 * 
 * 【目的】
 * Google Spreadsheet (ID: 1rUonEtTRN8t8aECCJBWeKPShEmnMiIQHkGdUMeAM3_g) / GAS WebApp 
 * またはローカルシードデータから Firebase Realtime Database へデータを一括移行・初期設定するスクリプト。
 * 
 * 【前提条件】
 * - Node.js v18 以上 (標準 fetch サポート)
 * - 既存の Firebase Realtime Database: https://viaglyph-workspace-default-rtdb.firebaseio.com/
 * 
 * 【実行方法】
 *   node scripts/migrate-data.js
 * 
 * 【移行対象パス】
 *   - /users
 *   - /tasks/dev
 *   - /tasks/biz
 *   - /workLogs
 *   - /goals
 *   - /memberStatus
 *   - /dailyMemos
 */

const DATABASE_URL = "https://viaglyph-workspace-default-rtdb.firebaseio.com";
const GAS_URL = "https://script.google.com/macros/s/AKfycbzjVV7PtqaeK3YGD_1uK6jVqLPJHmO1pWJVPJEC9A-2S24mthbVE3shoffip16NGbQZ/exec";

// メンバーマッピング
const USER_KEY_MAP = {
  '山口': 'yamaguchi',
  '市川': 'ichikawa',
  '村山': 'murayama'
};

const PREDEFINED_USERS = {
  yamaguchi: { email: "siteiiryoubugaihinn2@gmail.com", short: "山口", name: "山口 慧", role: "エンジニア", emoji: "🌿", bg: "#dcfce7" },
  ichikawa: { email: "shotaatut@gmail.com", short: "市川", name: "市川 翔大", role: "CEO / ビジネス", emoji: "🔥", bg: "#fef3c7" },
  murayama: { email: "murayama@mtl.t.u-tokyo.ac.jp", short: "村山", name: "村山 貴志", role: "テックリード", emoji: "💎", bg: "#dbeafe" }
};

// ローカルシードデータ（GAS未接続時またはレスポンス不整合時のフォールバック）
const FALLBACK_SEED = {
  tasks: {
    dev: {
      "1": { id: 1, title: "解法グラフ 全分野整備", status: "WIP", prio: "高", assign: "村山", due: "5/10", tags: ["開発", "未踏"], ctx: "dev", created_at: "2026-05-01T00:00:00.000Z" },
      "2": { id: 2, title: "スプリント2 開発着手", status: "WIP", prio: "高", assign: "村山", due: "5/18", tags: ["開発", "スプリント"], ctx: "dev", created_at: "2026-05-01T00:00:00.000Z" },
      "3": { id: 3, title: "QLYPH フロントエンド完成", status: "WIP", prio: "高", assign: "村山", due: "5/31", tags: ["開発", "フロント"], ctx: "dev", created_at: "2026-05-01T00:00:00.000Z" },
      "4": { id: 4, title: "認証バックエンド実装（Rails 8）", status: "TODO", prio: "中", assign: "村山", due: "6/6", tags: ["開発", "バックエンド"], ctx: "dev", created_at: "2026-05-01T00:00:00.000Z" },
      "5": { id: 5, title: "SEE:D→カリキュラムマップ連動", status: "TODO", prio: "中", assign: "村山", due: "6/30", tags: ["開発"], ctx: "dev", created_at: "2026-05-01T00:00:00.000Z" },
      "6": { id: 6, title: "知識マップ著作権分離", status: "Blocked", prio: "高", assign: "村山", due: "随時", tags: ["開発", "法務"], ctx: "dev", created_at: "2026-05-01T00:00:00.000Z" }
    },
    biz: {
      "10": { id: 10, title: "日報アプリ開発", status: "WIP", prio: "高", assign: "山口", due: "5/10", tags: ["開発", "社内"], ctx: "biz", created_at: "2026-05-01T00:00:00.000Z" },
      "11": { id: 11, title: "塾の生徒募集計画", status: "TODO", prio: "中", assign: "市川", due: "5/15", tags: ["ビジネス", "塾"], ctx: "biz", created_at: "2026-05-01T00:00:00.000Z" },
      "12": { id: 12, title: "法律確認の結果共有", status: "Blocked", prio: "中", assign: "市川", due: "随時", tags: ["法務"], ctx: "biz", created_at: "2026-05-01T00:00:00.000Z" },
      "13": { id: 13, title: "投資家向け資料作成", status: "TODO", prio: "高", assign: "山口", due: "5/20", tags: ["ビジネス"], ctx: "biz", created_at: "2026-05-01T00:00:00.000Z" },
      "14": { id: 14, title: "週次MTG議事録", status: "Done", prio: "中", assign: "全員", due: "5/3", tags: ["定例"], ctx: "biz", created_at: "2026-05-01T00:00:00.000Z" }
    }
  },
  workLogs: {
    "1715000000000_1": {
      id: 1715000000000,
      taskId: 10,
      date: "2026-05-10",
      minutes: 30,
      tags: ["開発", "社内"],
      comment: "看板からDoneに移動",
      user: "山口",
      createdAt: "2026-05-10T10:00:00.000Z"
    }
  },
  goals: [
    {
      id: 1, name: "ViaGLYPH", icon: "🧠", status: "active", assignees: [], due: "",
      bigGoals: [
        {
          id: 10, name: "未踏アドバンスト採択", status: "active", assignees: [], due: "",
          midGoals: [
            {
              id: 100, name: "申請書完成", status: "active", assignees: [], due: "",
              tasks: [
                { id: 1001, name: "知識グラフ設計書", done: false, assign: ["村山"], due: "" },
                { id: 1002, name: "SEE:D連携仕様", done: false, assign: ["村山"], due: "" },
                { id: 1003, name: "予算計画", done: true, assign: ["市川"], due: "" }
              ]
            },
            {
              id: 101, name: "プロト開発", status: "active", assignees: [], due: "",
              tasks: [
                { id: 1004, name: "QLYPH フロントエンド", done: false, assign: ["村山"], due: "" },
                { id: 1005, name: "認証バックエンド", done: false, assign: ["村山"], due: "" }
              ]
            }
          ]
        },
        {
          id: 11, name: "Sprint 2 完走", status: "active", assignees: [], due: "",
          midGoals: [
            {
              id: 110, name: "開発目標", status: "active", assignees: [], due: "",
              tasks: [
                { id: 1010, name: "解法グラフ全分野整備", done: false, assign: ["村山"], due: "" },
                { id: 1011, name: "スプリント2開発着手", done: false, assign: ["村山"], due: "" }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 2, name: "塾事業", icon: "📚", status: "active", assignees: [], due: "",
      bigGoals: [
        {
          id: 20, name: "生徒10名獲得", status: "active", assignees: [], due: "",
          midGoals: [
            {
              id: 200, name: "集客", status: "active", assignees: [], due: "",
              tasks: [
                { id: 2001, name: "募集計画策定", done: false, assign: ["市川"], due: "" },
                { id: 2002, name: "チラシ作成", done: false, assign: ["山口"], due: "" }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 3, name: "社内基盤", icon: "⚙️", status: "active", assignees: [], due: "",
      bigGoals: [
        {
          id: 30, name: "チーム運用効率化", status: "active", assignees: [], due: "",
          midGoals: [
            {
              id: 300, name: "ツール整備", status: "active", assignees: [], due: "",
              tasks: [
                { id: 3001, name: "日報アプリ開発", done: false, assign: ["山口"], due: "" },
                { id: 3002, name: "Discord Bot安定化", done: false, assign: ["山口"], due: "" }
              ]
            }
          ]
        }
      ]
    }
  ],
  memberStatus: {
    yamaguchi: "online",
    ichikawa: "away",
    murayama: "online"
  },
  dailyMemos: {
    "2026-05-10_山口": "本日のふりかえりノート内容..."
  }
};

/**
 * 補助関数: タグのフォーマット (文字列→配列)
 */
function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string' && tags.trim() !== '') {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

/**
 * GAS WebApp からデータ取得を試行
 */
async function fetchFromGAS() {
  console.log("📥 GAS WebApp からのライブデータ取得を試行中...");
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒タイムアウト

    const [tasksRes, workLogsRes, goalsRes, statusRes, memosRes] = await Promise.all([
      fetch(`${GAS_URL}?action=getTasks&token=offline_seed`, { signal: controller.signal }),
      fetch(`${GAS_URL}?action=getWorkLogs&token=offline_seed`, { signal: controller.signal }),
      fetch(`${GAS_URL}?action=getGoals&token=offline_seed`, { signal: controller.signal }),
      fetch(`${GAS_URL}?action=getMemberStatus&token=offline_seed`, { signal: controller.signal }),
      fetch(`${GAS_URL}?action=getDailyMemos&token=offline_seed`, { signal: controller.signal })
    ]);
    clearTimeout(timeoutId);

    if (tasksRes.ok && workLogsRes.ok && goalsRes.ok && statusRes.ok && memosRes.ok) {
      const tasksData = await tasksRes.json();
      const workLogsData = await workLogsRes.json();
      const goalsData = await goalsRes.json();
      const statusData = await statusRes.json();
      const memosData = await memosRes.json();

      if (tasksData.success && Array.isArray(tasksData.tasks)) {
        console.log("✅ GASからのライブデータ取得に成功しました。");
        return {
          tasks: tasksData.tasks,
          workLogs: workLogsData.workLogs || [],
          goals: goalsData.goals || [],
          memberStatus: statusData.statuses || {},
          dailyMemos: memosData.memos || {}
        };
      }
    }
  } catch (err) {
    console.warn("⚠️ GASからの取得に失敗またはタイムアウトしました。ローカルシードデータにフォールバックします。", err.message);
  }
  return null;
}

/**
 * GASの生のデータを Firebase RTDB スキーマ構造に変換
 */
function transformGASDataToPayload(gasData) {
  const payload = {
    users: PREDEFINED_USERS,
    tasks: { dev: {}, biz: {} },
    workLogs: {},
    goals: gasData.goals || FALLBACK_SEED.goals,
    memberStatus: {},
    dailyMemos: gasData.dailyMemos || FALLBACK_SEED.dailyMemos
  };

  // 1. Tasks の変換
  (gasData.tasks || []).forEach(t => {
    const ctx = t.ctx === 'biz' ? 'biz' : 'dev';
    const taskId = String(t.id);
    payload.tasks[ctx][taskId] = {
      id: Number(t.id),
      title: t.title || '',
      status: t.status || 'TODO',
      prio: t.prio || '中',
      assign: t.assign || '未定',
      due: t.due || '随時',
      tags: parseTags(t.tags),
      ctx: ctx,
      created_at: t.created_at || new Date().toISOString()
    };
  });

  // 2. WorkLogs の変換
  (gasData.workLogs || []).forEach((log, index) => {
    const key = log.id ? String(log.id) : `${Date.now()}_${index}`;
    payload.workLogs[key] = {
      id: Number(log.id || Date.now()),
      taskId: Number(log.taskId),
      date: log.date || new Date().toISOString().slice(0, 10),
      minutes: Number(log.minutes || 30),
      tags: parseTags(log.tags),
      comment: log.comment || '',
      user: log.user || '山口',
      createdAt: log.created_at || log.createdAt || new Date().toISOString()
    };
  });

  // 3. MemberStatus の変換
  if (typeof gasData.memberStatus === 'object') {
    Object.keys(gasData.memberStatus).forEach(userShort => {
      const userKey = USER_KEY_MAP[userShort] || userShort;
      payload.memberStatus[userKey] = gasData.memberStatus[userShort];
    });
  } else {
    payload.memberStatus = FALLBACK_SEED.memberStatus;
  }

  return payload;
}

/**
 * データの検証チェック (Verification Check)
 */
async function verifyMigration() {
  console.log("\n🔍 Firebase RTDB のデータ検証 (Verification Check) を開始します...");
  try {
    const res = await fetch(`${DATABASE_URL}/.json`);
    if (!res.ok) {
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }
    const rtdbData = await res.json();

    const devTasksRaw = rtdbData.tasks?.dev || {};
    const devTasksList = Array.isArray(devTasksRaw) ? devTasksRaw.filter(Boolean) : Object.values(devTasksRaw);
    const devTasksCount = devTasksList.length;

    const bizTasksRaw = rtdbData.tasks?.biz || {};
    const bizTasksList = Array.isArray(bizTasksRaw) ? bizTasksRaw.filter(Boolean) : Object.values(bizTasksRaw);
    const bizTasksCount = bizTasksList.length;

    const usersCount = Object.keys(rtdbData.users || {}).length;

    const workLogsRaw = rtdbData.workLogs || {};
    const workLogsList = Array.isArray(workLogsRaw) ? workLogsRaw.filter(Boolean) : Object.values(workLogsRaw);
    const workLogsCount = workLogsList.length;

    const goalsCount = Array.isArray(rtdbData.goals) ? rtdbData.goals.length : Object.keys(rtdbData.goals || {}).length;
    const memberStatusCount = Object.keys(rtdbData.memberStatus || {}).length;
    const dailyMemosCount = Object.keys(rtdbData.dailyMemos || {}).length;

    console.log("----------------------------------------");
    console.log("📊 検証結果サマリー:");
    console.log(`  • /users: ${usersCount} 件 (期待値 >= 3)`);
    console.log(`  • /tasks/dev: ${devTasksCount} 件 (期待値 >= 6)`);
    console.log(`  • /tasks/biz: ${bizTasksCount} 件 (期待値 >= 5)`);
    console.log(`  • /workLogs: ${workLogsCount} 件`);
    console.log(`  • /goals: ${goalsCount} プロジェクト (期待値 >= 3)`);
    console.log(`  • /memberStatus: ${memberStatusCount} 件 (期待値 >= 3)`);
    console.log(`  • /dailyMemos: ${dailyMemosCount} 件`);
    console.log("----------------------------------------");

    // タスク配列変換の検証
    const sampleDevTask = devTasksList[0];
    if (sampleDevTask && Array.isArray(sampleDevTask.tags)) {
      console.log(`✅ タスクタグ配列フォーマット確認成功: [${sampleDevTask.tags.join(', ')}]`);
    } else {
      console.warn("⚠️ タスクタグが配列型に変換されていません。");
    }

    if (devTasksCount >= 6 && bizTasksCount >= 5 && usersCount >= 3 && goalsCount >= 3 && memberStatusCount >= 3) {
      console.log("🎉 検証成功: すべてのデータが正しい構造で格納されています！");
      return true;
    } else {
      console.error("❌ 検証失敗: 一部のデータ件数が期待値に達していません。");
      return false;
    }
  } catch (err) {
    console.error("❌ 検証処理中にエラーが発生しました:", err.message);
    return false;
  }
}

/**
 * メイン移行ルーチン
 */
async function runMigration() {
  console.log("🚀 ViaGLYPH データ移行処理を開始します...");

  // 1. データ取得
  const gasData = await fetchFromGAS();
  
  // 2. ペイロード構築
  let payload;
  if (gasData) {
    payload = transformGASDataToPayload(gasData);
  } else {
    console.log("📦 ローカルシードデータを使用してペイロードを構築します。");
    payload = {
      users: PREDEFINED_USERS,
      tasks: FALLBACK_SEED.tasks,
      workLogs: FALLBACK_SEED.workLogs,
      goals: FALLBACK_SEED.goals,
      memberStatus: FALLBACK_SEED.memberStatus,
      dailyMemos: FALLBACK_SEED.dailyMemos
    };
  }

  // 3. RTDBへPATCHアップロード
  console.log("🔥 Firebase Realtime Database へデータをパッチ送信中...");
  try {
    const res = await fetch(`${DATABASE_URL}/.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      console.log("✅ データ送信が成功しました。");
      // 4. データ検証
      const success = await verifyMigration();
      if (success) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } else {
      const errText = await res.text();
      console.error(`❌ RTDBへの書き込みに失敗しました (${res.status}): ${errText}`);
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ 送信中にネットワークエラーが発生しました:", err.message);
    process.exit(1);
  }
}

// 実行
runMigration();
