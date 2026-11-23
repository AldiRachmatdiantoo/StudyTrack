/**
 * Kontrak abstraksi layanan AI Complexity Triage (PRD.md Section 3.2).
 *
 * Menyediakan:
 * - Interface base class `ITaskPrioritizerService`
 * - JSON Schema Structured Outputs untuk OpenAI GPT API
 * - Helper validasi output JSON & fallback deterministik (`deadline ASC`)
 */
import crypto from "crypto";

/**
 * @typedef {Object} PrioritizableTask
 * @property {number} id
 * @property {string} judul
 * @property {string} [deskripsi]
 * @property {string|Date} deadline
 * @property {string} [mata_kuliah]
 */

/**
 * @typedef {Object} RankedTaskItem
 * @property {number} task_id
 * @property {number|null} complexity_score
 * @property {string|null} ai_reason
 */

/**
 * @typedef {Object} PrioritizationResult
 * @property {RankedTaskItem[]} ranked_tasks
 * @property {{
 *   source: "openai" | "cache" | "fallback",
 *   cached: boolean,
 *   model?: string,
 *   cache_key?: string,
 *   fallback_reason?: string
 * }} meta
 */

/**
 * JSON Schema untuk OpenAI Structured Outputs (`response_format.type = "json_schema"`).
 * Sesuai kontrak output pada PRD.md Section 3.2.
 */
export const COMPLEXITY_TRIAGE_JSON_SCHEMA = {
  name: "task_complexity_triage",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ranked_tasks"],
    properties: {
      ranked_tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["task_id", "complexity_score", "ai_reason"],
          properties: {
            task_id: {
              type: "integer",
              description: "ID unik tugas sesuai input."
            },
            complexity_score: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "Skor kompleksitas tugas dari 1 (paling ringan) hingga 10 (paling rumit)."
            },
            ai_reason: {
              type: "string",
              description: "Alasan singkat (1 kalimat Bahasa Indonesia) mengapa tugas mendapat skor tersebut."
            }
          }
        }
      }
    }
  }
};

/**
 * Membuat hash cache deterministik dari daftar tugas berdasarkan:
 * `[task.id + task.judul + task.deskripsi + task.deadline]`.
 * Urutan input dinormalisasi berdasarkan `task.id` agar urutan array tidak mengubah key.
 *
 * @param {PrioritizableTask[]} tasks
 * @returns {string}
 */
export function buildTasksCacheKey(tasks) {
  const canonical = [...tasks]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((task) => {
      const deadlineIso =
        task.deadline instanceof Date
          ? task.deadline.toISOString()
          : new Date(task.deadline).toISOString();
      return `${task.id}|${(task.judul || "").trim()}|${(task.deskripsi || "").trim()}|${deadlineIso}`;
    })
    .join("||");

  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Validasi ketat kontrak JSON output dari GPT (atau provider AI lainnya).
 * Memastikan seluruh task_id input hadir tepat satu kali, skor 1-10, dan ai_reason non-empty string.
 *
 * @param {unknown} payload
 * @param {PrioritizableTask[]} inputTasks
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateRankedTasksPayload(payload, inputTasks) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.ranked_tasks)) {
    return { valid: false, error: "Payload harus berupa objek dengan array 'ranked_tasks'." };
  }

  const expectedIds = new Set(inputTasks.map((t) => Number(t.id)));
  if (payload.ranked_tasks.length !== expectedIds.size) {
    return {
      valid: false,
      error: `Jumlah ranked_tasks (${payload.ranked_tasks.length}) tidak sesuai jumlah input (${expectedIds.size}).`
    };
  }

  const seenIds = new Set();
  for (const item of payload.ranked_tasks) {
    if (!item || typeof item !== "object") {
      return { valid: false, error: "Elemen ranked_tasks harus berupa objek." };
    }

    const taskId = Number(item.task_id);
    if (!Number.isInteger(taskId) || !expectedIds.has(taskId)) {
      return { valid: false, error: `task_id tidak valid atau tidak dikenal: ${item.task_id}` };
    }
    if (seenIds.has(taskId)) {
      return { valid: false, error: `Duplikat task_id ditemukan: ${taskId}` };
    }
    seenIds.add(taskId);

    if (
      typeof item.complexity_score !== "number" ||
      !Number.isInteger(item.complexity_score) ||
      item.complexity_score < 1 ||
      item.complexity_score > 10
    ) {
      return {
        valid: false,
        error: `complexity_score harus integer 1..10 untuk task_id ${taskId}, diterima: ${item.complexity_score}`
      };
    }

    if (typeof item.ai_reason !== "string" || item.ai_reason.trim().length === 0) {
      return {
        valid: false,
        error: `ai_reason harus string non-kosong untuk task_id ${taskId}.`
      };
    }
  }

  return { valid: true };
}

/**
 * Membangun hasil fallback deterministik sesuai PRD.md Section 3.2:
 * urutan `deadline ASC`, `complexity_score: null`, `ai_reason: null`.
 *
 * @param {PrioritizableTask[]} tasks
 * @param {string} fallbackReason
 * @returns {PrioritizationResult}
 */
export function buildFallbackResult(tasks, fallbackReason) {
  const sorted = [...tasks].sort((a, b) => {
    const timeA = new Date(a.deadline).getTime();
    const timeB = new Date(b.deadline).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return Number(a.id) - Number(b.id);
  });

  return {
    ranked_tasks: sorted.map((task) => ({
      task_id: Number(task.id),
      complexity_score: null,
      ai_reason: null
    })),
    meta: {
      source: "fallback",
      cached: false,
      fallback_reason: fallbackReason
    }
  };
}

/**
 * Interface (base class) layanan prioritas tugas berbasis kompleksitas.
 */
export class ITaskPrioritizerService {
  /**
   * Menganalisis dan mengurutkan daftar tugas mendekati deadline.
   *
   * @param {PrioritizableTask[]} _tasks
   * @returns {Promise<PrioritizationResult>}
   */
  async prioritizeTasks(_tasks) {
    throw new Error("Method 'prioritizeTasks(tasks)' harus diimplementasikan oleh subclass.");
  }
}
