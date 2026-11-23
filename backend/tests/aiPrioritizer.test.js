/**
 * Test script terisolasi untuk Modul 1: OpenAI GPT Complexity Triage Service.
 *
 * Memvalidasi:
 * 1. Kontrak interface `ITaskPrioritizerService` & JSON Schema Structured Outputs
 * 2. Output JSON & pengurutan kompleksitas (Project 3: BSTMap vs Lab 4: Query Optimization)
 * 3. In-Memory Cache berbasis hash tugas (order-insensitive & invalidasi saat data berubah)
 * 4. Graceful Fallback saat OPENAI_API_KEY kosong (deadline ASC, ai_reason: null)
 * 5. Graceful Fallback saat timeout (> timeoutMs)
 * 6. Graceful Fallback saat OpenAI error (429 quota) & output JSON tidak valid
 * 7. Optimasi < 2 tugas (tidak memanggil OpenAI)
 * 8. [Opsional Live Test] Jika OPENAI_API_KEY terisi di .env, validasi langsung ke OpenAI API
 *
 * Jalankan: `npm run test:ai` (atau `node tests/aiPrioritizer.test.js`)
 */
import assert from "node:assert/strict";
import { OPENAI_API_KEY } from "../config.js";
import {
  ITaskPrioritizerService,
  COMPLEXITY_TRIAGE_JSON_SCHEMA,
  validateRankedTasksPayload
} from "../services/taskPrioritizer.interface.js";
import { OpenAiPrioritizerProvider } from "../services/openaiPrioritizer.service.js";

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// Dua tugas mepet (< 24 jam) sesuai skenario guidebook & PROGRESS.md.
// Sengaja dibuat deadline Lab 4 (10 jam) LEBIH CEPAT daripada Project 3 BSTMap (18 jam)
// untuk membuktikan AI Triage memprioritaskan kompleksitas, sedangkan fallback memakai deadline ASC.
const SAMPLE_TASKS = [
  {
    id: 1,
    judul: "Lab 4: Query Optimization Report",
    deskripsi: "Laporan hasil eksperimen optimasi query beserta analisis query plan.",
    deadline: hoursFromNow(10),
    mata_kuliah: "Database Systems"
  },
  {
    id: 2,
    judul: "Project 3: BSTMap Implementation",
    deskripsi:
      "Implementasi Binary Search Tree Map (insert, delete, rebalance, iterator) beserta unit test komprehensif dan analisis kompleksitas waktu.",
    deadline: hoursFromNow(18),
    mata_kuliah: "Data Structures"
  }
];

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

console.log("\n=== Modul 1: AI Complexity Triage Service Validation ===\n");

// 1. Interface & JSON Schema
await runTest("1. Interface ITaskPrioritizerService & JSON Schema sesuai PRD 3.2", async () => {
  const provider = new OpenAiPrioritizerProvider({ apiKey: "", logger: silentLogger });
  assert.ok(provider instanceof ITaskPrioritizerService);
  assert.equal(COMPLEXITY_TRIAGE_JSON_SCHEMA.strict, true);
  assert.deepEqual(COMPLEXITY_TRIAGE_JSON_SCHEMA.schema.required, ["ranked_tasks"]);
  assert.deepEqual(
    COMPLEXITY_TRIAGE_JSON_SCHEMA.schema.properties.ranked_tasks.items.required,
    ["task_id", "complexity_score", "ai_reason"]
  );

  // Valid payload
  const validCheck = validateRankedTasksPayload(
    {
      ranked_tasks: [
        {
          task_id: 2,
          complexity_score: 9,
          ai_reason: "Implementasi BSTMap butuh perancangan struktur data dan debugging intensif."
        },
        {
          task_id: 1,
          complexity_score: 5,
          ai_reason: "Laporan optimasi query bersifat analitis dengan kompleksitas implementasi lebih rendah."
        }
      ]
    },
    SAMPLE_TASKS
  );
  assert.equal(validCheck.valid, true);

  // Invalid payloads
  assert.equal(validateRankedTasksPayload({ ranked_tasks: [] }, SAMPLE_TASKS).valid, false);
  assert.equal(
    validateRankedTasksPayload(
      {
        ranked_tasks: [
          { task_id: 2, complexity_score: 11, ai_reason: "Skor invalid" },
          { task_id: 1, complexity_score: 5, ai_reason: "OK" }
        ]
      },
      SAMPLE_TASKS
    ).valid,
    false
  );
  assert.equal(
    validateRankedTasksPayload(
      {
        ranked_tasks: [
          { task_id: 2, complexity_score: 9, ai_reason: "" },
          { task_id: 1, complexity_score: 5, ai_reason: "OK" }
        ]
      },
      SAMPLE_TASKS
    ).valid,
    false
  );
});

// 2. Structured Outputs & Ranking BSTMap > Lab 4
await runTest("2. Structured Outputs JSON valid & Project 3 BSTMap naik ke posisi #1", async () => {
  let capturedRequest = null;
  const mockClient = {
    chat: {
      completions: {
        async create(params) {
          capturedRequest = params;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ranked_tasks: [
                      {
                        task_id: 1,
                        complexity_score: 5,
                        ai_reason: "Laporan analisis query plan relatif lebih terstruktur dan cepat diselesaikan."
                      },
                      {
                        task_id: 2,
                        complexity_score: 9,
                        ai_reason:
                          "Implementasi BSTMap membutuhkan perancangan struktur data dan debugging intensif dibanding laporan kueri."
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
  };

  const provider = new OpenAiPrioritizerProvider({
    apiKey: "test-key",
    model: "gpt-4o-mini",
    client: mockClient,
    logger: silentLogger
  });

  const result = await provider.prioritizeTasks(SAMPLE_TASKS);

  // Pastikan parameter OpenAI request sesuai PRD
  assert.equal(capturedRequest.model, "gpt-4o-mini");
  assert.equal(capturedRequest.response_format.type, "json_schema");
  assert.equal(capturedRequest.response_format.json_schema.name, "task_complexity_triage");

  // Validasi hasil JSON
  const check = validateRankedTasksPayload(result, SAMPLE_TASKS);
  assert.equal(check.valid, true, check.error);
  assert.equal(result.meta.source, "openai");
  assert.equal(result.meta.cached, false);

  // Pastikan BSTMap (id 2) di posisi #1 meskipun deadline-nya lebih lama dari Lab 4 (id 1)
  assert.equal(result.ranked_tasks[0].task_id, 2);
  assert.equal(result.ranked_tasks[0].complexity_score, 9);
  assert.ok(result.ranked_tasks[0].ai_reason.length > 0);
  assert.equal(result.ranked_tasks[1].task_id, 1);
  assert.equal(result.ranked_tasks[1].complexity_score, 5);
});

// 3. In-Memory Cache
await runTest("3. In-Memory Cache mencegah pemanggilan ulang & invalidasi saat tugas berubah", async () => {
  let callCount = 0;
  const mockClient = {
    chat: {
      completions: {
        async create() {
          callCount += 1;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ranked_tasks: [
                      {
                        task_id: 2,
                        complexity_score: 9,
                        ai_reason: "Implementasi BSTMap lebih kompleks."
                      },
                      {
                        task_id: 1,
                        complexity_score: 4,
                        ai_reason: "Laporan query lebih ringan."
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
  };

  const provider = new OpenAiPrioritizerProvider({
    apiKey: "test-key",
    client: mockClient,
    logger: silentLogger
  });

  const first = await provider.prioritizeTasks(SAMPLE_TASKS);
  assert.equal(callCount, 1);
  assert.equal(first.meta.source, "openai");
  assert.equal(first.meta.cached, false);

  // Panggilan kedua dengan urutan array dibalik -> tetap cache HIT
  const second = await provider.prioritizeTasks([SAMPLE_TASKS[1], SAMPLE_TASKS[0]]);
  assert.equal(callCount, 1);
  assert.equal(second.meta.source, "cache");
  assert.equal(second.meta.cached, true);
  assert.deepEqual(second.ranked_tasks, first.ranked_tasks);

  // Ubah deskripsi salah satu tugas -> cache MISS -> panggil OpenAI lagi
  const modifiedTasks = [
    { ...SAMPLE_TASKS[0], deskripsi: "Laporan query plus implementasi cost-based optimizer penuh." },
    SAMPLE_TASKS[1]
  ];
  const third = await provider.prioritizeTasks(modifiedTasks);
  assert.equal(callCount, 2);
  assert.equal(third.meta.source, "openai");
  assert.equal(third.meta.cached, false);
});

// 4. Graceful Fallback saat OPENAI_API_KEY kosong
await runTest("4. Graceful Fallback saat OPENAI_API_KEY kosong (deadline ASC, ai_reason: null)", async () => {
  const provider = new OpenAiPrioritizerProvider({
    apiKey: "",
    logger: silentLogger
  });

  // Kirim dengan urutan terbalik (deadline 18 jam dulu, lalu 10 jam)
  const result = await provider.prioritizeTasks([SAMPLE_TASKS[1], SAMPLE_TASKS[0]]);
  assert.equal(result.meta.source, "fallback");
  assert.equal(result.meta.fallback_reason, "missing_api_key");
  assert.equal(silentLogger.warnings.length, 1);

  // Harus terurut deadline ASC: Lab 4 (10 jam, id=1) dulu, baru BSTMap (18 jam, id=2)
  assert.deepEqual(result.ranked_tasks, [
    { task_id: 1, complexity_score: null, ai_reason: null },
    { task_id: 2, complexity_score: null, ai_reason: null }
  ]);
});

// 5. Graceful Fallback saat timeout
await runTest("5. Graceful Fallback saat request OpenAI melebihi batas timeout", async () => {
  const slowClient = {
    chat: {
      completions: {
        create(_params, { signal }) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ choices: [] }), 2000);
            signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
      }
    }
  };

  const provider = new OpenAiPrioritizerProvider({
    apiKey: "test-key",
    timeoutMs: 120,
    client: slowClient,
    logger: silentLogger
  });

  const startedAt = Date.now();
  const result = await provider.prioritizeTasks([SAMPLE_TASKS[1], SAMPLE_TASKS[0]]);
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 1000, `Timeout fallback terlalu lambat: ${elapsed}ms`);
  assert.equal(result.meta.source, "fallback");
  assert.equal(result.meta.fallback_reason, "timeout");
  assert.equal(result.ranked_tasks[0].task_id, 1);
  assert.equal(result.ranked_tasks[0].ai_reason, null);
  assert.equal(provider.getCacheStats().size, 0, "Hasil fallback tidak boleh disimpan ke cache.");
});

// 6. Graceful Fallback saat error kuota 429 & malformed JSON
await runTest("6. Graceful Fallback saat error API (429) atau JSON tidak sesuai schema", async () => {
  const errorClient = {
    chat: {
      completions: {
        async create() {
          const err = new Error("429 You exceeded your current quota");
          err.status = 429;
          throw err;
        }
      }
    }
  };

  const providerErr = new OpenAiPrioritizerProvider({
    apiKey: "test-key",
    client: errorClient,
    logger: silentLogger
  });

  const resErr = await providerErr.prioritizeTasks([SAMPLE_TASKS[1], SAMPLE_TASKS[0]]);
  assert.equal(resErr.meta.source, "fallback");
  assert.equal(resErr.meta.fallback_reason, "openai_error");
  assert.equal(resErr.ranked_tasks[0].task_id, 1);
  assert.equal(resErr.ranked_tasks[0].ai_reason, null);

  const badJsonClient = {
    chat: {
      completions: {
        async create() {
          return {
            choices: [{ message: { content: JSON.stringify({ ranked_tasks: [{ task_id: 999 }] }) } }]
          };
        }
      }
    }
  };

  const providerBad = new OpenAiPrioritizerProvider({
    apiKey: "test-key",
    client: badJsonClient,
    logger: silentLogger
  });

  const resBad = await providerBad.prioritizeTasks([SAMPLE_TASKS[1], SAMPLE_TASKS[0]]);
  assert.equal(resBad.meta.source, "fallback");
  assert.equal(resBad.meta.fallback_reason, "openai_error");
  assert.equal(resBad.ranked_tasks[0].task_id, 1);
});

// 7. Optimasi < 2 tugas
await runTest("7. Tidak memanggil OpenAI jika jumlah tugas mendekati deadline < 2", async () => {
  let called = false;
  const mockClient = {
    chat: {
      completions: {
        async create() {
          called = true;
          return {};
        }
      }
    }
  };

  const provider = new OpenAiPrioritizerProvider({
    apiKey: "test-key",
    client: mockClient,
    logger: silentLogger
  });

  const singleResult = await provider.prioritizeTasks([SAMPLE_TASKS[0]]);
  assert.equal(called, false);
  assert.equal(singleResult.meta.source, "fallback");
  assert.equal(singleResult.meta.fallback_reason, "insufficient_tasks");
  assert.deepEqual(singleResult.ranked_tasks, [
    { task_id: 1, complexity_score: null, ai_reason: null }
  ]);
});

// 8. Live OpenAI API test (otomatis jalan jika OPENAI_API_KEY terisi di .env)
if (OPENAI_API_KEY) {
  await runTest("8. [LIVE OpenAI API] Validasi output JSON nyata dari gpt-4o-mini", async () => {
    const liveProvider = new OpenAiPrioritizerProvider();
    const liveResult = await liveProvider.prioritizeTasks(SAMPLE_TASKS);

    console.log("\n  Live OpenAI Output JSON:");
    console.log(JSON.stringify(liveResult, null, 2));

    assert.equal(liveResult.meta.source, "openai");
    const check = validateRankedTasksPayload(liveResult, SAMPLE_TASKS);
    assert.equal(check.valid, true, check.error);
    assert.equal(
      liveResult.ranked_tasks[0].task_id,
      2,
      "Project 3: BSTMap Implementation seharusnya diprioritaskan di posisi #1."
    );
    assert.ok(
      liveResult.ranked_tasks[0].complexity_score > liveResult.ranked_tasks[1].complexity_score,
      "Skor kompleksitas BSTMap seharusnya lebih tinggi dari Lab 4."
    );

    // Pastikan panggilan kedua kena cache
    const cachedResult = await liveProvider.prioritizeTasks(SAMPLE_TASKS);
    assert.equal(cachedResult.meta.source, "cache");
    assert.equal(cachedResult.meta.cached, true);
  });
} else {
  console.log(
    "  [SKIP] 8. [LIVE OpenAI API] OPENAI_API_KEY belum diisi di backend/.env — isi key lalu jalankan `npm run test:ai` untuk uji langsung ke gpt-4o-mini."
  );
}

console.log(`\nRingkasan: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) {
  process.exit(1);
}
