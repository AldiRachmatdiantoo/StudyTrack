/**
 * Pure utility function untuk klasifikasi urgensi deadline tugas (PRD.md Section 3.1).
 *
 * Seluruh perhitungan waktu dilakukan dalam epoch milidetik UTC agar presisi
 * dan bebas dari inkonsistensi zona waktu (UTC vs WIB / Asia/Jakarta).
 */

export const MS_PER_HOUR = 60 * 60 * 1000;
export const NEAR_DEADLINE_HOURS = 24;
export const NEAR_DEADLINE_WINDOW_MS = NEAR_DEADLINE_HOURS * MS_PER_HOUR;

export const URGENCY_CATEGORIES = Object.freeze({
  NEAR_DEADLINE: "mendekati_deadline",
  OVERDUE: "overdue",
  NORMAL: "normal",
  COMPLETED: "selesai"
});

/**
 * Mengonversi nilai waktu (Date, epoch ms, atau ISO string) menjadi epoch milidetik UTC.
 * String tanpa keterangan zona waktu (mis. format `datetime-local`) diperlakukan sebagai WIB (+07:00).
 *
 * @param {Date | number | string} value
 * @returns {number}
 */
export function parseTimestampToMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) {
      throw new Error("Timestamp Date tidak valid.");
    }
    return ms;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Timestamp numerik tidak valid.");
    }
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Timestamp string tidak boleh kosong.");
    }
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    const ms = new Date(hasTimezone ? trimmed : `${trimmed}+07:00`).getTime();
    if (Number.isNaN(ms)) {
      throw new Error(`Format timestamp tidak valid: ${value}`);
    }
    return ms;
  }

  throw new Error("Tipe timestamp tidak didukung.");
}

/**
 * Mengklasifikasikan satu tugas ke salah satu dari 4 kategori urgensi sesuai PRD.md Section 3.1:
 * - `selesai`: status === 'selesai' (tidak pernah memicu mendekati_deadline / overdue)
 * - `overdue`: status === 'belum' dan (deadline - now) < 0
 * - `mendekati_deadline`: status === 'belum' dan 0 <= (deadline - now) < 24 jam
 * - `normal`: status === 'belum' dan (deadline - now) >= 24 jam
 *
 * Perbandingan batas selalu menggunakan `diff_ms` mentah (bukan `remaining_hours` yang dibulatkan)
 * sehingga batas tepat 24 jam 00 menit tetap `normal` dan lewat 1 detik langsung `overdue`.
 *
 * @param {{ status: string, deadline: Date | number | string }} task
 * @param {Date | number | string} [currentTime]
 * @returns {{
 *   urgency_category: "mendekati_deadline" | "overdue" | "normal" | "selesai",
 *   remaining_hours: number,
 *   diff_ms: number
 * }}
 */
export function classifyTaskUrgency(task, currentTime = new Date()) {
  if (!task || typeof task !== "object") {
    throw new Error("Parameter task harus berupa objek.");
  }

  const nowMs = parseTimestampToMs(currentTime);
  const deadlineMs = parseTimestampToMs(task.deadline);
  const diffMs = deadlineMs - nowMs;

  const roundedHours = Math.round((diffMs / MS_PER_HOUR) * 10) / 10;
  const remainingHours = roundedHours === 0 ? 0 : roundedHours;

  if (task.status === "selesai") {
    return {
      urgency_category: URGENCY_CATEGORIES.COMPLETED,
      remaining_hours: remainingHours,
      diff_ms: diffMs
    };
  }

  if (diffMs < 0) {
    return {
      urgency_category: URGENCY_CATEGORIES.OVERDUE,
      remaining_hours: remainingHours,
      diff_ms: diffMs
    };
  }

  if (diffMs < NEAR_DEADLINE_WINDOW_MS) {
    return {
      urgency_category: URGENCY_CATEGORIES.NEAR_DEADLINE,
      remaining_hours: remainingHours,
      diff_ms: diffMs
    };
  }

  return {
    urgency_category: URGENCY_CATEGORIES.NORMAL,
    remaining_hours: remainingHours,
    diff_ms: diffMs
  };
}
