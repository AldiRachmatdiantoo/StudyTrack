/**
 * Test script untuk Modul 2: Core Deadline Classification & Hybrid Sorting Engine (F01–F04).
 *
 * Memvalidasi:
 * 1. Pure utility `classifyTaskUrgency(task, currentTime)` untuk semua kategori & edge case batas waktu
 * 2. Presisi zona waktu UTC vs WIB (+07:00)
 * 3. Pengelompokan 4 bucket (`mendekati_deadline` -> `overdue` -> `normal` -> `selesai`)
 * 4. Pengurutan internal tiap bucket (AI complexity DESC di Bucket 1, deadline DESC di Bucket 2, created_at DESC di Bucket 3 & 4)
 * 5. Graceful fallback (`deadline ASC`, `ai_priority.reason: null`) saat AI gagal/tidak aktif
 * 6. Optimasi tidak memanggil AI jika Bucket 1 hanya memiliki 1 tugas
 * 7. Kontrak payload JSON sesuai PRD.md Section 4.1
 *
 * Jalankan: `npm run test:deadline` (atau `node tests/deadlineOrdering.test.js`)
 */
import assert from "node:assert/strict";
import {
  URGENCY_CATEGORIES,
  classifyTaskUrgency
} from "../utils/deadlineClassifier.js";
import { sortAndEnrichTasks } from "../services/taskOrdering.service.js";
import { OpenAiPrioritizerProvider } from "../services/openaiPrioritizer.service.js";

const BASE_NOW = new Date("2026-07-02T00:00:00.000Z");

function isoOffsetMs(ms) {
  return new Date(BASE_NOW.getTime() + ms).toISOString();
}

function isoOffsetHours(hours) {
  return isoOffsetMs(hours * 60 * 60 * 1000);
}

const silentLogger = {
  warnings: [],
  warn(msg) {
    this.warnings.push(msg);
  },
  reset() {
    this.warnings = [];
  }
};

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  silentLogger.reset();
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
  }
}

console.log("\n=== Modul 2: Core Deadline Classification & Hybrid Sorting Validation ===\n");

// 1. Klasifikasi dasar 4 kategori
await runTest("1. classifyTaskUrgency mengklasifikasikan 4 kategori sesuai PRD 3.1", async () => {
  const near = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetHours(10) },
    BASE_NOW
  );
  assert.equal(near.urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);
  assert.equal(near.remaining_hours, 10);

  const overdue = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetHours(-5) },
    BASE_NOW
  );
  assert.equal(overdue.urgency_category, URGENCY_CATEGORIES.OVERDUE);
  assert.equal(overdue.remaining_hours, -5);

  const normal = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetHours(48) },
    BASE_NOW
  );
  assert.equal(normal.urgency_category, URGENCY_CATEGORIES.NORMAL);
  assert.equal(normal.remaining_hours, 48);

  // Tugas selesai tidak pernah memicu mendekati_deadline atau overdue
  const doneNear = classifyTaskUrgency(
    { status: "selesai", deadline: isoOffsetHours(2) },
    BASE_NOW
  );
  assert.equal(doneNear.urgency_category, URGENCY_CATEGORIES.COMPLETED);

  const doneOverdue = classifyTaskUrgency(
    { status: "selesai", deadline: isoOffsetHours(-3) },
    BASE_NOW
  );
  assert.equal(doneOverdue.urgency_category, URGENCY_CATEGORIES.COMPLETED);
});

// 2. Edge cases batas 24 jam & 0 detik
await runTest("2. Edge cases batas waktu: tepat 24 jam = normal, 23:59:59 = mendekati_deadline, lewat 1 menit = overdue", async () => {
  // Tepat 24 jam 00 menit 00 detik -> normal
  const exact24h = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetHours(24) },
    BASE_NOW
  );
  assert.equal(exact24h.urgency_category, URGENCY_CATEGORIES.NORMAL);
  assert.equal(exact24h.remaining_hours, 24);

  // 23 jam 59 menit 59 detik -> mendekati_deadline
  const justUnder24h = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetMs(24 * 60 * 60 * 1000 - 1000) },
    BASE_NOW
  );
  assert.equal(justUnder24h.urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);

  // Tepat 0 detik -> mendekati_deadline (0 <= sisa < 24 jam)
  const exactZero = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetMs(0) },
    BASE_NOW
  );
  assert.equal(exactZero.urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);
  assert.equal(exactZero.remaining_hours, 0);

  // Baru lewat 1 menit -> overdue
  const pastOneMinute = classifyTaskUrgency(
    { status: "belum", deadline: isoOffsetMs(-60 * 1000) },
    BASE_NOW
  );
  assert.equal(pastOneMinute.urgency_category, URGENCY_CATEGORIES.OVERDUE);
  assert.ok(pastOneMinute.diff_ms < 0);
});

// 3. Presisi zona waktu UTC vs WIB (+07:00)
await runTest("3. Presisi zona waktu UTC vs WIB (+07:00) konsisten tanpa selisih 7 jam", async () => {
  const nowUtc = "2026-07-02T00:00:00.000Z"; // = 2026-07-02 07:00:00 WIB

  // 17:00 WIB = 10:00 UTC -> sisa tepat 10 jam
  const fromUtc = classifyTaskUrgency(
    { status: "belum", deadline: "2026-07-02T10:00:00.000Z" },
    nowUtc
  );
  const fromWibExplicit = classifyTaskUrgency(
    { status: "belum", deadline: "2026-07-02T17:00:00+07:00" },
    nowUtc
  );
  const fromWibNaive = classifyTaskUrgency(
    { status: "belum", deadline: "2026-07-02T17:00" },
    nowUtc
  );

  assert.equal(fromUtc.remaining_hours, 10);
  assert.equal(fromWibExplicit.remaining_hours, 10);
  assert.equal(fromWibNaive.remaining_hours, 10);
  assert.equal(fromUtc.diff_ms, fromWibExplicit.diff_ms);
  assert.equal(fromUtc.diff_ms, fromWibNaive.diff_ms);
});

// Dataset gabungan lintas 4 bucket
const SAMPLE_ROWS = [
  {
    id: 10,
    user_id: 1,
    mata_kuliah_id: 2,
    mk_id: 2,
    mk_kode: "CS 61B",
    mk_name: "Data Structures",
    judul: "Quiz 1: Asymptotic Analysis",
    deskripsi: "Latihan soal analisis Big-O.",
    deadline: isoOffsetHours(3),
    status: "selesai",
    created_at: isoOffsetHours(-100)
  },
  {
    id: 11,
    user_id: 1,
    mata_kuliah_id: 3,
    mk_id: 3,
    mk_kode: "CS 169",
    mk_name: "Software Engineering",
    judul: "Sprint 2: Backend API Integration",
    deskripsi: "Integrasi endpoint backend ke frontend.",
    deadline: isoOffsetHours(72),
    status: "belum",
    created_at: isoOffsetHours(-20)
  },
  {
    id: 12,
    user_id: 1,
    mata_kuliah_id: 3,
    mk_id: 3,
    mk_kode: "CS 169",
    mk_name: "Software Engineering",
    judul: "Sprint 3: Deployment Setup",
    deskripsi: "Konfigurasi environment production.",
    deadline: isoOffsetHours(96),
    status: "belum",
    created_at: isoOffsetHours(-5) // lebih baru dari id 11 -> harus di atas id 11 di Bucket 3
  },
  {
    id: 13,
    user_id: 1,
    mata_kuliah_id: 1,
    mk_id: 1,
    mk_kode: "CS 186",
    mk_name: "Database Systems",
    judul: "Lab 2: Buffer Manager",
    deskripsi: "Implementasi LRU replacement policy.",
    deadline: isoOffsetHours(-24),
    status: "belum",
    created_at: isoOffsetHours(-200)
  },
  {
    id: 14,
    user_id: 1,
    mata_kuliah_id: 1,
    mk_id: 1,
    mk_kode: "CS 186",
    mk_name: "Database Systems",
    judul: "Lab 3: B+ Tree Indexing",
    deskripsi: "Implementasi split dan merge node B+ Tree.",
    deadline: isoOffsetHours(-2), // lebih baru terlewat daripada id 13 -> harus di atas id 13 di Bucket 2
    status: "belum",
    created_at: isoOffsetHours(-120)
  },
  {
    id: 1,
    user_id: 1,
    mata_kuliah_id: 1,
    mk_id: 1,
    mk_kode: "CS 186",
    mk_name: "Database Systems",
    judul: "Lab 4: Query Optimization Report",
    deskripsi: "Laporan hasil eksperimen optimasi query.",
    deadline: isoOffsetHours(10), // deadline lebih cepat dari BSTMap
    status: "belum",
    created_at: isoOffsetHours(-72)
  },
  {
    id: 2,
    user_id: 1,
    mata_kuliah_id: 2,
    mk_id: 2,
    mk_kode: "CS 61B",
    mk_name: "Data Structures",
    judul: "Project 3: BSTMap Implementation",
    deskripsi: "Implementasi Binary Search Tree Map lengkap dengan unit test.",
    deadline: isoOffsetHours(14.5), // deadline lebih lama, tapi lebih rumit
    status: "belum",
    created_at: isoOffsetHours(-48)
  }
];

// 4. 4-Bucket hybrid sorting dengan AI aktif
await runTest("4. Pengelompokan 4 bucket & AI Triage mengangkat BSTMap ke posisi #1", async () => {
  const mockPrioritizer = {
    async prioritizeTasks(tasks) {
      assert.equal(tasks.length, 2, "Hanya tugas di Bucket 1 yang boleh dikirim ke AI.");
      return {
        ranked_tasks: [
          {
            task_id: 2,
            complexity_score: 9,
            ai_reason: "Implementasi BSTMap membutuhkan perancangan struktur data dan debugging intensif."
          },
          {
            task_id: 1,
            complexity_score: 5,
            ai_reason: "Laporan optimasi query bersifat analitis dan lebih cepat diselesaikan."
          }
        ],
        meta: { source: "openai", cached: false, model: "gpt-4o-mini" }
      };
    }
  };

  const result = await sortAndEnrichTasks(SAMPLE_ROWS, {
    now: BASE_NOW,
    prioritizer: mockPrioritizer,
    logger: silentLogger
  });

  // Urutan ID yang diharapkan:
  // Bucket 1 (AI complexity DESC): 2 (BSTMap), 1 (Lab 4)
  // Bucket 2 (overdue, deadline DESC): 14 (-2h), 13 (-24h)
  // Bucket 3 (normal, created_at DESC): 12 (-5h), 11 (-20h)
  // Bucket 4 (selesai, created_at DESC): 10
  assert.deepEqual(
    result.map((t) => t.id),
    [2, 1, 14, 13, 12, 11, 10]
  );

  assert.deepEqual(
    result.map((t) => t.urgency_category),
    [
      "mendekati_deadline",
      "mendekati_deadline",
      "overdue",
      "overdue",
      "normal",
      "normal",
      "selesai"
    ]
  );

  // Validasi kontrak PRD Section 4.1 pada top AI pick
  const topTask = result[0];
  assert.deepEqual(topTask.mata_kuliah, {
    id: 2,
    kode: "CS 61B",
    name: "Data Structures"
  });
  assert.equal(topTask.remaining_hours, 14.5);
  assert.deepEqual(topTask.ai_priority, {
    is_top_ai_pick: true,
    complexity_score: 9,
    reason: "Implementasi BSTMap membutuhkan perancangan struktur data dan debugging intensif."
  });

  // Tugas kedua di Bucket 1 bukan top pick, namun tetap punya skor & alasan
  assert.equal(result[1].ai_priority.is_top_ai_pick, false);
  assert.equal(result[1].ai_priority.complexity_score, 5);
  assert.ok(result[1].ai_priority.reason.length > 0);

  // Bucket 2, 3, 4 memiliki ai_priority: null
  assert.equal(result[2].ai_priority, null);
  assert.equal(result[4].ai_priority, null);
  assert.equal(result[6].ai_priority, null);
});

// 5. Graceful fallback (deadline ASC) saat AI gagal / API key kosong
await runTest("5. Graceful fallback mengurutkan Bucket 1 berdasarkan deadline ASC dengan reason: null", async () => {
  const fallbackProvider = new OpenAiPrioritizerProvider({
    apiKey: "",
    logger: silentLogger
  });

  const result = await sortAndEnrichTasks(SAMPLE_ROWS, {
    now: BASE_NOW,
    prioritizer: fallbackProvider,
    logger: silentLogger
  });

  // Bucket 1 sekarang deadline ASC: id 1 (10h) dulu, baru id 2 (14.5h)
  assert.deepEqual(
    result.map((t) => t.id),
    [1, 2, 14, 13, 12, 11, 10]
  );

  assert.deepEqual(result[0].ai_priority, {
    is_top_ai_pick: false,
    complexity_score: null,
    reason: null
  });
  assert.deepEqual(result[1].ai_priority, {
    is_top_ai_pick: false,
    complexity_score: null,
    reason: null
  });
});

// 6. Optimasi: 1 tugas di Bucket 1 tidak memanggil AI
await runTest("6. Bucket 1 dengan 1 tugas tidak memanggil ITaskPrioritizerService", async () => {
  let called = false;
  const spyPrioritizer = {
    async prioritizeTasks() {
      called = true;
      return { ranked_tasks: [], meta: { source: "openai", cached: false } };
    }
  };

  const singleNearRows = SAMPLE_ROWS.filter((r) => r.id !== 2);
  const result = await sortAndEnrichTasks(singleNearRows, {
    now: BASE_NOW,
    prioritizer: spyPrioritizer,
    logger: silentLogger
  });

  assert.equal(called, false, "AI tidak boleh dipanggil jika Bucket 1 < 2 tugas.");
  assert.equal(result[0].id, 1);
  assert.equal(result[0].urgency_category, "mendekati_deadline");
  assert.deepEqual(result[0].ai_priority, {
    is_top_ai_pick: false,
    complexity_score: null,
    reason: null
  });
});

console.log(`\nRingkasan: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
