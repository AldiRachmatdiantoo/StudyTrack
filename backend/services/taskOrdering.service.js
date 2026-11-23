/**
 * Hybrid Sorting & 4-Bucket Classification Service untuk daftar tugas (PRD.md Section 3.1 & 4.1).
 *
 * Menggabungkan:
 * - Pure classifier `classifyTaskUrgency(task, currentTime)`
 * - Pengelompokan 4 bucket: `mendekati_deadline` -> `overdue` -> `normal` -> `selesai`
 * - AI Complexity Triage (`ITaskPrioritizerService`) untuk Bucket 1 jika jumlah tugas >= 2
 * - Graceful fallback (`deadline ASC`) jika tugas di Bucket 1 < 2 atau AI gagal/timeout
 */
import {
  URGENCY_CATEGORIES,
  classifyTaskUrgency,
  parseTimestampToMs
} from "../utils/deadlineClassifier.js";
import { taskPrioritizerService } from "./openaiPrioritizer.service.js";

/**
 * Mengubah nilai waktu (Date / string / number) menjadi ISO 8601 UTC string.
 * @param {Date | string | number} value
 * @returns {string}
 */
function toIsoUtc(value) {
  return new Date(parseTimestampToMs(value)).toISOString();
}

/**
 * Membentuk objek `mata_kuliah` sesuai kontrak PRD.md Section 4.1:
 * `{ id, kode, name }`.
 *
 * @param {object} row
 * @returns {{ id: number, kode: string, name: string }}
 */
function normalizeCourseObject(row) {
  if (row.mata_kuliah && typeof row.mata_kuliah === "object") {
    return {
      id: Number(row.mata_kuliah.id),
      kode: String(row.mata_kuliah.kode ?? ""),
      name: String(row.mata_kuliah.name ?? "")
    };
  }

  return {
    id: Number(row.mk_id ?? row.mata_kuliah_id),
    kode: String(row.mk_kode ?? ""),
    name: String(row.mk_name ?? row.mata_kuliah ?? "")
  };
}

/**
 * Mengurutkan berdasarkan `deadline ASC` (tie-breaker: `id ASC`).
 */
function sortByDeadlineAsc(a, b) {
  const diff = a._deadlineMs - b._deadlineMs;
  if (diff !== 0) return diff;
  return a.id - b.id;
}

/**
 * Mengurutkan berdasarkan `deadline DESC` (yang baru saja terlewat di atas, tie-breaker: `id ASC`).
 */
function sortByDeadlineDesc(a, b) {
  const diff = b._deadlineMs - a._deadlineMs;
  if (diff !== 0) return diff;
  return a.id - b.id;
}

/**
 * Mengurutkan berdasarkan `created_at DESC` (perilaku bawaan sistem, tie-breaker: `id DESC`).
 */
function sortByCreatedAtDesc(a, b) {
  const diff = b._createdAtMs - a._createdAtMs;
  if (diff !== 0) return diff;
  return b.id - a.id;
}

/**
 * Menghapus properti internal (`_deadlineMs`, `_createdAtMs`) sebelum dikirim ke klien.
 */
function toPublicTask(entry, aiPriority) {
  return {
    id: entry.id,
    user_id: entry.user_id,
    mata_kuliah_id: entry.mata_kuliah_id,
    judul: entry.judul,
    deskripsi: entry.deskripsi,
    deadline: entry.deadline,
    status: entry.status,
    created_at: entry.created_at,
    mata_kuliah: entry.mata_kuliah,
    urgency_category: entry.urgency_category,
    remaining_hours: entry.remaining_hours,
    ai_priority: aiPriority
  };
}

/**
 * Mengklasifikasikan, mengurutkan dalam 4 bucket, dan memperkaya daftar tugas
 * dengan `urgency_category`, `remaining_hours`, dan `ai_priority`.
 *
 * @param {Array<object>} rawTasks Daftar tugas dari database
 * @param {Object} [options]
 * @param {Date | number | string} [options.now] Waktu referensi (default: `new Date()`)
 * @param {import("./taskPrioritizer.interface.js").ITaskPrioritizerService} [options.prioritizer]
 * @param {{ warn: Function }} [options.logger]
 * @returns {Promise<Array<object>>}
 */
export async function sortAndEnrichTasks(rawTasks, options = {}) {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    return [];
  }

  const now = options.now !== undefined ? options.now : new Date();
  const prioritizer = options.prioritizer || taskPrioritizerService;
  const logger = options.logger || console;

  const buckets = {
    [URGENCY_CATEGORIES.NEAR_DEADLINE]: [],
    [URGENCY_CATEGORIES.OVERDUE]: [],
    [URGENCY_CATEGORIES.NORMAL]: [],
    [URGENCY_CATEGORIES.COMPLETED]: []
  };

  for (const row of rawTasks) {
    const { urgency_category, remaining_hours } = classifyTaskUrgency(row, now);
    const deadlineMs = parseTimestampToMs(row.deadline);
    const createdAtMs = row.created_at !== undefined ? parseTimestampToMs(row.created_at) : 0;

    const normalized = {
      id: Number(row.id),
      user_id: row.user_id !== undefined ? Number(row.user_id) : undefined,
      mata_kuliah_id: Number(row.mata_kuliah_id ?? row.mk_id ?? row.mata_kuliah?.id),
      judul: row.judul,
      deskripsi: row.deskripsi ?? "",
      deadline: toIsoUtc(deadlineMs),
      status: row.status,
      created_at: row.created_at !== undefined ? toIsoUtc(createdAtMs) : undefined,
      mata_kuliah: normalizeCourseObject(row),
      urgency_category,
      remaining_hours,
      _deadlineMs: deadlineMs,
      _createdAtMs: createdAtMs
    };

    buckets[urgency_category].push(normalized);
  }

  // Bucket 1: mendekati_deadline
  const nearDeadlineTasks = buckets[URGENCY_CATEGORIES.NEAR_DEADLINE];
  let sortedNearDeadline = [];

  if (nearDeadlineTasks.length === 1) {
    sortedNearDeadline = [
      toPublicTask(nearDeadlineTasks[0], {
        is_top_ai_pick: false,
        complexity_score: null,
        reason: null
      })
    ];
  } else if (nearDeadlineTasks.length >= 2) {
    const taskMap = new Map(nearDeadlineTasks.map((t) => [t.id, t]));
    let prioritizationResult = null;

    try {
      const prioritizerInput = nearDeadlineTasks.map((t) => ({
        id: t.id,
        judul: t.judul,
        deskripsi: t.deskripsi,
        deadline: t.deadline,
        mata_kuliah: t.mata_kuliah.name
      }));
      prioritizationResult = await prioritizer.prioritizeTasks(prioritizerInput);
    } catch (err) {
      logger.warn(
        `[TaskOrdering] Prioritizer threw unexpected error: ${err?.message || err}. Menggunakan fallback deadline ASC.`
      );
      prioritizationResult = null;
    }

    const isAiActive =
      prioritizationResult &&
      (prioritizationResult.meta?.source === "openai" ||
        prioritizationResult.meta?.source === "cache") &&
      Array.isArray(prioritizationResult.ranked_tasks) &&
      prioritizationResult.ranked_tasks.length === nearDeadlineTasks.length;

    if (isAiActive) {
      const seenIds = new Set();
      const ordered = [];

      for (const item of prioritizationResult.ranked_tasks) {
        const taskId = Number(item.task_id);
        const taskEntry = taskMap.get(taskId);
        if (!taskEntry || seenIds.has(taskId)) continue;
        seenIds.add(taskId);

        const isTopPick = ordered.length === 0;
        ordered.push(
          toPublicTask(taskEntry, {
            is_top_ai_pick: isTopPick,
            complexity_score: item.complexity_score,
            reason: item.ai_reason
          })
        );
      }

      if (ordered.length === nearDeadlineTasks.length) {
        sortedNearDeadline = ordered;
      }
    }

    // Graceful fallback: deadline ASC dengan ai_priority.reason: null
    if (sortedNearDeadline.length === 0) {
      sortedNearDeadline = [...nearDeadlineTasks]
        .sort(sortByDeadlineAsc)
        .map((entry) =>
          toPublicTask(entry, {
            is_top_ai_pick: false,
            complexity_score: null,
            reason: null
          })
        );
    }
  }

  // Bucket 2: overdue (deadline DESC)
  const sortedOverdue = buckets[URGENCY_CATEGORIES.OVERDUE]
    .sort(sortByDeadlineDesc)
    .map((entry) => toPublicTask(entry, null));

  // Bucket 3: normal (created_at DESC)
  const sortedNormal = buckets[URGENCY_CATEGORIES.NORMAL]
    .sort(sortByCreatedAtDesc)
    .map((entry) => toPublicTask(entry, null));

  // Bucket 4: selesai (created_at DESC)
  const sortedCompleted = buckets[URGENCY_CATEGORIES.COMPLETED]
    .sort(sortByCreatedAtDesc)
    .map((entry) => toPublicTask(entry, null));

  return [
    ...sortedNearDeadline,
    ...sortedOverdue,
    ...sortedNormal,
    ...sortedCompleted
  ];
}
