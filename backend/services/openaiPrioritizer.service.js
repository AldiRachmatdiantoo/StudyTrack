/**
 * Implementasi `ITaskPrioritizerService` menggunakan OpenAI GPT API (`gpt-4o-mini`)
 * dengan Structured Outputs (JSON Schema), In-Memory Cache berbasis hash tugas,
 * dan Graceful Fallback (`deadline ASC`) jika API key kosong, error, atau timeout (> 3500ms).
 */
import OpenAI from "openai";
import { OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TIMEOUT_MS } from "../config.js";
import {
  ITaskPrioritizerService,
  COMPLEXITY_TRIAGE_JSON_SCHEMA,
  buildTasksCacheKey,
  validateRankedTasksPayload,
  buildFallbackResult
} from "./taskPrioritizer.interface.js";

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit
const DEFAULT_MAX_CACHE_ENTRIES = 200;

const SYSTEM_PROMPT = [
  "Anda adalah asisten akademik ahli ilmu komputer dan manajemen waktu mahasiswa.",
  "Tugas Anda adalah menganalisis tingkat kerumitan (complexity) beberapa tugas kuliah yang sama-sama mendekati deadline (< 24 jam).",
  "Evaluasi berdasarkan: kedalaman teknis (implementasi kode/algoritma/struktur data vs laporan/kuis), jumlah sub-komponen, kebutuhan debugging/testing, dan estimasi usaha pengerjaan.",
  "Berikan complexity_score bilangan bulat 1-10 (10 = paling rumit & butuh dimulai paling dulu).",
  "Urutkan ranked_tasks dari complexity_score tertinggi ke terendah.",
  "Tulis ai_reason secara ringkas (1 kalimat padat dalam Bahasa Indonesia) yang membandingkan alasan teknis prioritas tugas tersebut."
].join(" ");

export class OpenAiPrioritizerProvider extends ITaskPrioritizerService {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   * @param {number} [options.timeoutMs]
   * @param {import("openai").default | null} [options.client]
   * @param {number} [options.cacheTtlMs]
   * @param {number} [options.maxCacheEntries]
   * @param {{ warn: Function }} [options.logger]
   */
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey !== undefined ? String(options.apiKey).trim() : OPENAI_API_KEY;
    this.model = options.model || OPENAI_MODEL || "gpt-4o-mini";
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : OPENAI_TIMEOUT_MS;
    this.cacheTtlMs =
      Number(options.cacheTtlMs) > 0 ? Number(options.cacheTtlMs) : DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries =
      Number(options.maxCacheEntries) > 0
        ? Number(options.maxCacheEntries)
        : DEFAULT_MAX_CACHE_ENTRIES;
    this.logger = options.logger || console;

    // Mendukung dependency injection `client` untuk pengujian terisolasi
    if (options.client !== undefined) {
      this.client = options.client;
    } else if (this.apiKey) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        timeout: this.timeoutMs,
        maxRetries: 0
      });
    } else {
      this.client = null;
    }

    /** @type {Map<string, { ranked_tasks: Array, expiresAt: number, model: string }>} */
    this.cache = new Map();
  }

  /**
   * Mengambil hasil dari cache jika ada dan belum kedaluwarsa.
   * @param {string} cacheKey
   */
  _getCached(cacheKey) {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return null;
    }
    return {
      ranked_tasks: entry.ranked_tasks.map((item) => ({ ...item })),
      model: entry.model
    };
  }

  /**
   * Menyimpan hasil analisis AI ke in-memory cache dengan batas ukuran.
   * @param {string} cacheKey
   * @param {Array} rankedTasks
   */
  _setCached(cacheKey, rankedTasks) {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(cacheKey, {
      ranked_tasks: rankedTasks.map((item) => ({ ...item })),
      model: this.model,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  /**
   * Menghapus seluruh entri cache (berguna untuk pengujian).
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * @returns {{ size: number }}
   */
  getCacheStats() {
    return { size: this.cache.size };
  }

  /**
   * Menganalisis kompleksitas daftar tugas mendekati deadline (< 24 jam).
   *
   * @param {import("./taskPrioritizer.interface.js").PrioritizableTask[]} tasks
   * @returns {Promise<import("./taskPrioritizer.interface.js").PrioritizationResult>}
   */
  async prioritizeTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return buildFallbackResult([], "empty_tasks");
    }

    // Sesuai PRD Section 3.1: AI Triage hanya dipanggil jika jumlah tugas >= 2
    if (tasks.length < 2) {
      return buildFallbackResult(tasks, "insufficient_tasks");
    }

    const cacheKey = buildTasksCacheKey(tasks);
    const cached = this._getCached(cacheKey);
    if (cached) {
      return {
        ranked_tasks: cached.ranked_tasks,
        meta: {
          source: "cache",
          cached: true,
          model: cached.model,
          cache_key: cacheKey
        }
      };
    }

    if (!this.client) {
      this.logger.warn(
        "[AI Complexity Triage] OPENAI_API_KEY kosong. Menggunakan graceful fallback (deadline ASC)."
      );
      return buildFallbackResult(tasks, "missing_api_key");
    }

    const taskById = new Map(tasks.map((t) => [Number(t.id), t]));
    const userPayload = tasks.map((t) => ({
      task_id: Number(t.id),
      judul: t.judul,
      deskripsi: t.deskripsi || "",
      deadline_utc:
        t.deadline instanceof Date ? t.deadline.toISOString() : new Date(t.deadline).toISOString(),
      ...(t.mata_kuliah ? { mata_kuliah: t.mata_kuliah } : {})
    }));

    const controller = new AbortController();
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const timeoutErr = new Error(`OpenAI request timeout setelah ${this.timeoutMs}ms`);
        timeoutErr.name = "AbortError";
        controller.abort(timeoutErr);
        reject(timeoutErr);
      }, this.timeoutMs);
    });

    try {
      const apiPromise = this.client.chat.completions.create(
        {
          model: this.model,
          temperature: 0.2,
          response_format: {
            type: "json_schema",
            json_schema: COMPLEXITY_TRIAGE_JSON_SCHEMA
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                instruction:
                  "Analisis dan urutkan tugas-tugas mendekati deadline berikut berdasarkan tingkat kompleksitas pengerjaan.",
                tasks: userPayload
              })
            }
          ]
        },
        { signal: controller.signal }
      );

      const response = await Promise.race([apiPromise, timeoutPromise]);

      const rawContent = response?.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        throw new Error("Respons OpenAI tidak mengandung konten JSON.");
      }

      const parsed = JSON.parse(rawContent);
      const validation = validateRankedTasksPayload(parsed, tasks);
      if (!validation.valid) {
        throw new Error(`Validasi JSON Schema gagal: ${validation.error}`);
      }

      // Pastikan urutan final selalu complexity_score DESC (tie-breaker: deadline ASC)
      const rankedTasks = parsed.ranked_tasks
        .map((item) => ({
          task_id: Number(item.task_id),
          complexity_score: Number(item.complexity_score),
          ai_reason: item.ai_reason.trim()
        }))
        .sort((a, b) => {
          if (b.complexity_score !== a.complexity_score) {
            return b.complexity_score - a.complexity_score;
          }
          const deadlineA = new Date(taskById.get(a.task_id).deadline).getTime();
          const deadlineB = new Date(taskById.get(b.task_id).deadline).getTime();
          return deadlineA - deadlineB;
        });

      this._setCached(cacheKey, rankedTasks);

      return {
        ranked_tasks: rankedTasks,
        meta: {
          source: "openai",
          cached: false,
          model: this.model,
          cache_key: cacheKey
        }
      };
    } catch (err) {
      const isTimeout =
        controller.signal.aborted ||
        err?.name === "AbortError" ||
        err?.name === "APIConnectionTimeoutError";
      const fallbackReason = isTimeout ? "timeout" : "openai_error";
      this.logger.warn(
        `[AI Complexity Triage] Gagal memanggil OpenAI (${fallbackReason}): ${err?.message || err}. Menggunakan fallback deadline ASC.`
      );
      return buildFallbackResult(tasks, fallbackReason);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const taskPrioritizerService = new OpenAiPrioritizerProvider();
