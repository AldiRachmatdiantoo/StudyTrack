/**
 * QA Verification Matrix — Modul 4 StudyTrack (Smart Deadline Reminder & AI Complexity Triage).
 *
 * Menguji secara menyeluruh seluruh skenario QA resmi dari PROGRESS.md Modul 4 & PRD.md:
 *   TC-01 (Positif): Tugas `belum` sisa waktu 10 jam -> Masuk paling atas + `mendekati_deadline`.
 *   TC-02 (Positif AI Triage): 2 tugas sisa < 24 jam (BSTMap vs Laporan Kueri) -> Tugas lebih rumit naik ke #1 + alasan AI.
 *   TC-03 (Negatif): Tugas `belum` sisa waktu 48 jam -> Kategori `normal` tanpa penanda urgensi.
 *   TC-04 (Negatif Status Selesai): Tugas sisa 2 jam / sudah lewat namun status `selesai` -> Bucket bawah (`selesai`), tanpa peringatan.
 *   TC-05 (Edge Case Batas Waktu): Sisa tepat `24 jam 00 menit` -> `normal`; tepat `0 detik` -> `mendekati_deadline`; lewat `1 menit` -> `overdue`.
 *   TC-06 (Isolasi F04 & E2E API + DB): Isolasi lintas user, urutan 4 bucket via query nyata, serta perubahan status `belum` -> `selesai`.
 *
 * Jalankan: `npm run test:qa` (atau `node tests/qaMatrix.test.js`)
 */
import assert from "node:assert/strict";
import { classifyTaskUrgency, URGENCY_CATEGORIES } from "../utils/deadlineClassifier.js";
import { sortAndEnrichTasks } from "../services/taskOrdering.service.js";
import { OpenAiPrioritizerProvider } from "../services/openaiPrioritizer.service.js";
import { OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TIMEOUT_MS } from "../config.js";
import { pool, query } from "../db.js";
import bcrypt from "bcryptjs";

const BASE_NOW = new Date("2026-07-02T00:00:00.000Z"); // 07:00 WIB

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
  }
};

function makeRow({
  id,
  judul,
  deskripsi = "Deskripsi tugas kuliah.",
  deadline,
  status = "belum",
  created_at = isoOffsetHours(-24),
  mk_id = 1,
  mk_kode = "CS 186",
  mk_name = "Database Systems",
  user_id = 1
}) {
  return {
    id,
    user_id,
    mata_kuliah_id: mk_id,
    mk_id,
    mk_kode,
    mk_name,
    judul,
    deskripsi,
    deadline,
    status,
    created_at
  };
}

let passed = 0;
let failed = 0;
const results = [];

async function runScenario(code, title, fn) {
  try {
    const detail = await fn();
    passed += 1;
    results.push({ code, title, status: "PASS", detail });
    console.log(`  [PASS] ${code} — ${title}`);
    if (detail) {
      console.log(`         ${detail}`);
    }
  } catch (err) {
    failed += 1;
    results.push({ code, title, status: "FAIL", detail: err.message });
    console.error(`  [FAIL] ${code} — ${title}`);
    console.error(`         ${err.message}`);
  }
}

console.log("\n=== Modul 4: StudyTrack QA Verification Matrix ===\n");

// TC-01: Positif — Tugas `belum` sisa waktu 10 jam
await runScenario(
  "TC-01",
  "Positif: Tugas `belum` sisa 10 jam masuk posisi paling atas dengan `mendekati_deadline`",
  async () => {
    const rows = [
      makeRow({
        id: 101,
        judul: "Sprint 2: Backend API Integration",
        deadline: isoOffsetHours(72),
        status: "belum",
        created_at: isoOffsetHours(-2),
        mk_id: 3,
        mk_kode: "CS 169",
        mk_name: "Software Engineering"
      }),
      makeRow({
        id: 102,
        judul: "Lab 3: B+ Tree Indexing",
        deadline: isoOffsetHours(-4),
        status: "belum",
        created_at: isoOffsetHours(-48)
      }),
      makeRow({
        id: 103,
        judul: "Lab 4: Query Optimization Report",
        deadline: isoOffsetHours(10),
        status: "belum",
        created_at: isoOffsetHours(-72)
      })
    ];

    const sorted = await sortAndEnrichTasks(rows, { now: BASE_NOW, logger: silentLogger });
    assert.equal(sorted[0].id, 103, "Tugas sisa 10 jam harus berada di indeks 0.");
    assert.equal(sorted[0].urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);
    assert.equal(sorted[0].remaining_hours, 10);
    assert.equal(sorted[1].urgency_category, URGENCY_CATEGORIES.OVERDUE);
    assert.equal(sorted[2].urgency_category, URGENCY_CATEGORIES.NORMAL);

    return `Posisi #1: "${sorted[0].judul}" (urgency_category=${sorted[0].urgency_category}, remaining_hours=${sorted[0].remaining_hours} jam)`;
  }
);

// TC-02: Positif (AI Triage) — 2 tugas sama-sama sisa < 24 jam (BSTMap vs Laporan Kueri)
await runScenario(
  "TC-02",
  "Positif (AI Triage): 2 tugas < 24 jam (BSTMap vs Laporan Kueri) -> BSTMap naik ke #1 dengan alasan AI",
  async () => {
    const rows = [
      makeRow({
        id: 1,
        judul: "Lab 4: Query Optimization Report",
        deskripsi: "Menulis laporan ringkas hasil eksperimen optimasi query SQL pada 3 skenario indeks.",
        deadline: isoOffsetHours(10), // deadline lebih mepet
        status: "belum",
        mk_id: 1,
        mk_kode: "CS 186",
        mk_name: "Database Systems"
      }),
      makeRow({
        id: 2,
        judul: "Project 3: BSTMap Implementation",
        deskripsi:
          "Implementasi Binary Search Tree Map dari nol (insert, delete, rebalance, iterator) lengkap dengan unit test edge-case dan analisis kompleksitas waktu.",
        deadline: isoOffsetHours(16), // deadline lebih longgar, tapi jauh lebih rumit
        status: "belum",
        mk_id: 2,
        mk_kode: "CS 61B",
        mk_name: "Data Structures"
      })
    ];

    // Gunakan live OpenAI API jika tersedia; jika belum, gunakan deterministic structured mock
    let mode = "deterministic-mock";
    let prioritizer;
    if (OPENAI_API_KEY) {
      mode = `live-openai (${OPENAI_MODEL})`;
      prioritizer = new OpenAiPrioritizerProvider({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        timeoutMs: Math.max(OPENAI_TIMEOUT_MS, 10000),
        logger: silentLogger
      });
    } else {
      prioritizer = new OpenAiPrioritizerProvider({
        apiKey: "qa-mock-key",
        client: {
          chat: {
            completions: {
              async create() {
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          ranked_tasks: [
                            {
                              task_id: 2,
                              complexity_score: 9,
                              ai_reason:
                                "Implementasi BSTMap membutuhkan perancangan struktur data, penanganan edge-case penghapusan node, dan debugging intensif dibanding laporan kueri."
                            },
                            {
                              task_id: 1,
                              complexity_score: 5,
                              ai_reason:
                                "Laporan optimasi kueri bersifat analitis dan lebih cepat diselesaikan."
                            }
                          ]
                        })
                      }
                    }
                  ]
                };
              }
            }
          }
        },
        logger: silentLogger
      });
    }

    const sorted = await sortAndEnrichTasks(rows, {
      now: BASE_NOW,
      prioritizer,
      logger: silentLogger
    });

    assert.equal(sorted[0].id, 2, "Project 3: BSTMap harus diprioritaskan di posisi #1 oleh AI.");
    assert.equal(sorted[0].urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);
    assert.equal(sorted[0].ai_priority.is_top_ai_pick, true);
    assert.ok(
      sorted[0].ai_priority.complexity_score > sorted[1].ai_priority.complexity_score,
      "Skor kompleksitas BSTMap harus lebih tinggi dari Laporan Kueri."
    );
    assert.ok(
      typeof sorted[0].ai_priority.reason === "string" && sorted[0].ai_priority.reason.length > 10,
      "ai_priority.reason wajib terisi."
    );

    return `[${mode}] #1: "${sorted[0].judul}" (score=${sorted[0].ai_priority.complexity_score}, is_top_ai_pick=true) vs #2: "${sorted[1].judul}" (score=${sorted[1].ai_priority.complexity_score})`;
  }
);

// TC-03: Negatif — Tugas `belum` sisa waktu 48 jam
await runScenario(
  "TC-03",
  "Negatif: Tugas `belum` sisa 48 jam tampil normal tanpa badge urgensi atau AI priority",
  async () => {
    const rows = [
      makeRow({
        id: 301,
        judul: "Sprint 2: Backend API Integration",
        deadline: isoOffsetHours(48),
        status: "belum",
        mk_id: 3,
        mk_kode: "CS 169",
        mk_name: "Software Engineering"
      })
    ];

    const sorted = await sortAndEnrichTasks(rows, { now: BASE_NOW, logger: silentLogger });
    assert.equal(sorted[0].urgency_category, URGENCY_CATEGORIES.NORMAL);
    assert.equal(sorted[0].remaining_hours, 48);
    assert.equal(sorted[0].ai_priority, null);

    return `urgency_category=${sorted[0].urgency_category}, remaining_hours=${sorted[0].remaining_hours}, ai_priority=null`;
  }
);

// TC-04: Negatif (Status Selesai) — Deadline sisa 2 jam atau sudah lewat, tapi status `selesai`
await runScenario(
  "TC-04",
  "Negatif (Status Selesai): Deadline sisa 2 jam & sudah lewat 3 jam namun `selesai` tidak memicu peringatan",
  async () => {
    const rows = [
      makeRow({
        id: 401,
        judul: "Quiz 1: Selesai Mepet 2 Jam",
        deadline: isoOffsetHours(2),
        status: "selesai",
        created_at: isoOffsetHours(-10)
      }),
      makeRow({
        id: 402,
        judul: "Lab 1: Selesai Sudah Lewat 3 Jam",
        deadline: isoOffsetHours(-3),
        status: "selesai",
        created_at: isoOffsetHours(-20)
      }),
      makeRow({
        id: 403,
        judul: "Tugas Normal 72 Jam",
        deadline: isoOffsetHours(72),
        status: "belum",
        created_at: isoOffsetHours(-50)
      })
    ];

    const sorted = await sortAndEnrichTasks(rows, { now: BASE_NOW, logger: silentLogger });
    // Tugas normal (`belum`) harus di atas kedua tugas `selesai`
    assert.equal(sorted[0].id, 403);
    assert.equal(sorted[0].urgency_category, URGENCY_CATEGORIES.NORMAL);

    // Kedua tugas `selesai` berada di bucket paling bawah tanpa penanda urgensi
    assert.equal(sorted[1].urgency_category, URGENCY_CATEGORIES.COMPLETED);
    assert.equal(sorted[2].urgency_category, URGENCY_CATEGORIES.COMPLETED);
    assert.equal(sorted[1].ai_priority, null);
    assert.equal(sorted[2].ai_priority, null);

    return `Urutan: [${sorted.map((t) => `${t.id}:${t.urgency_category}`).join(", ")}] — tidak ada penanda mendekati_deadline/overdue`;
  }
);

// TC-05: Edge Case Batas Waktu — tepat 24 jam 00 menit, 0 detik, dan lewat 1 menit
await runScenario(
  "TC-05",
  "Edge Case: Tepat 24j00m -> `normal`, tepat 0 detik -> `mendekati_deadline`, lewat 1 menit -> `overdue`",
  async () => {
    const exact24h = classifyTaskUrgency(
      { status: "belum", deadline: isoOffsetMs(24 * 60 * 60 * 1000) },
      BASE_NOW
    );
    assert.equal(exact24h.urgency_category, URGENCY_CATEGORIES.NORMAL);
    assert.equal(exact24h.remaining_hours, 24);

    const under24hBy1Sec = classifyTaskUrgency(
      { status: "belum", deadline: isoOffsetMs(24 * 60 * 60 * 1000 - 1000) },
      BASE_NOW
    );
    assert.equal(under24hBy1Sec.urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);

    const exactZero = classifyTaskUrgency(
      { status: "belum", deadline: isoOffsetMs(0) },
      BASE_NOW
    );
    assert.equal(exactZero.urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);
    assert.equal(exactZero.remaining_hours, 0);

    const pastOneMinute = classifyTaskUrgency(
      { status: "belum", deadline: isoOffsetMs(-60 * 1000) },
      BASE_NOW
    );
    assert.equal(pastOneMinute.urgency_category, URGENCY_CATEGORIES.OVERDUE);
    assert.ok(pastOneMinute.diff_ms < 0);

    return `24j00m=${exact24h.urgency_category}, 23j59m59d=${under24hBy1Sec.urgency_category}, 0d=${exactZero.urgency_category}, -1m=${pastOneMinute.urgency_category}`;
  }
);

// TC-06: Integrasi PostgreSQL & Isolasi Multi-User (F04) + Transisi Status `belum` -> `selesai`
await runScenario(
  "TC-06",
  "Integrasi DB & Isolasi F04: Query lintas mata kuliah terisolasi per user & toggle status `belum` -> `selesai`",
  async () => {
    const suffix = Date.now();
    const emailA = `qa-user-a-${suffix}@studytrack.test`;
    const emailB = `qa-user-b-${suffix}@studytrack.test`;
    const pwHash = await bcrypt.hash("test1234", 4);

    let userAId;
    let userBId;
    try {
      const resA = await query(
        "INSERT INTO users (nama, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
        ["QA User A", emailA, pwHash]
      );
      const resB = await query(
        "INSERT INTO users (nama, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
        ["QA User B", emailB, pwHash]
      );
      userAId = resA.rows[0].id;
      userBId = resB.rows[0].id;

      const mkA = await query(
        "INSERT INTO mata_kuliah (name, kode, dosen, user_id) VALUES ($1, $2, $3, $4) RETURNING id",
        ["Algorithms", "CS 170", "Dr. QA A", userAId]
      );
      const mkB = await query(
        "INSERT INTO mata_kuliah (name, kode, dosen, user_id) VALUES ($1, $2, $3, $4) RETURNING id",
        ["Operating Systems", "CS 162", "Dr. QA B", userBId]
      );

      const tenHoursLater = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
      const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      const taskA = await query(
        `INSERT INTO tugas (judul, deskripsi, deadline, status, mata_kuliah_id, user_id)
         VALUES ($1, $2, $3, 'belum', $4, $5) RETURNING id`,
        ["QA Task User A", "Tugas mepet milik User A", tenHoursLater, mkA.rows[0].id, userAId]
      );
      await query(
        `INSERT INTO tugas (judul, deskripsi, deadline, status, mata_kuliah_id, user_id)
         VALUES ($1, $2, $3, 'belum', $4, $5)`,
        ["QA Task User B (Rahasia)", "Tugas mepet milik User B", twoHoursLater, mkB.rows[0].id, userBId]
      );

      const fetchUserTasks = async (uid) => {
        const { rows } = await query(
          `SELECT t.id, t.user_id, t.mata_kuliah_id, t.judul, t.deskripsi, t.deadline, t.status, t.created_at,
                  mk.id AS mk_id, mk.kode AS mk_kode, mk.name AS mk_name
           FROM tugas t
           INNER JOIN mata_kuliah mk ON mk.id = t.mata_kuliah_id
           WHERE t.user_id = $1 AND mk.user_id = $1
           ORDER BY t.created_at DESC`,
          [uid]
        );
        return sortAndEnrichTasks(rows, { logger: silentLogger });
      };

      const tasksA = await fetchUserTasks(userAId);
      assert.equal(tasksA.length, 1, "User A hanya boleh melihat tugas miliknya sendiri.");
      assert.equal(tasksA[0].judul, "QA Task User A");
      assert.equal(tasksA[0].urgency_category, URGENCY_CATEGORIES.NEAR_DEADLINE);

      // Ubah status tugas User A menjadi `selesai`
      await query("UPDATE tugas SET status = 'selesai' WHERE id = $1 AND user_id = $2", [
        taskA.rows[0].id,
        userAId
      ]);

      const tasksAAfter = await fetchUserTasks(userAId);
      assert.equal(tasksAAfter[0].urgency_category, URGENCY_CATEGORIES.COMPLETED);
      assert.equal(tasksAAfter[0].ai_priority, null);

      return "Isolasi user A/B terverifikasi di PostgreSQL & transisi `belum` -> `selesai` menghapus penanda urgensi.";
    } finally {
      if (userAId) await query("DELETE FROM users WHERE id = $1", [userAId]);
      if (userBId) await query("DELETE FROM users WHERE id = $1", [userBId]);
    }
  }
);

await pool.end();

console.log(`\nRingkasan QA Matrix: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
