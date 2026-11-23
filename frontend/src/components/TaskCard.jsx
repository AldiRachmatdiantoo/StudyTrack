import React from "react";

/**
 * Memformat deadline UTC dari API ke tampilan WIB (Asia/Jakarta),
 * contoh: "03 Jul 2026, 23.59 WIB".
 *
 * @param {string} deadline Tanggal dan jam deadline dari API (ISO UTC).
 * @returns {string}
 */
function formatDeadline(deadline) {
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return "-";
  const formatted = d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${formatted} WIB`;
}

/**
 * Memformat sisa waktu (jam) untuk kategori `mendekati_deadline` menjadi
 * teks hitung mundur yang mudah dibaca, contoh: "Sisa 14 jam 30 menit".
 *
 * @param {number | null | undefined} remainingHours
 * @returns {string}
 */
function formatRemainingCountdown(remainingHours) {
  if (typeof remainingHours !== "number" || !Number.isFinite(remainingHours)) {
    return "Kurang dari 24 jam";
  }
  const totalMinutes = Math.max(0, Math.round(remainingHours * 60));
  if (totalMinutes < 1) {
    return "Kurang dari 1 menit";
  }
  if (totalMinutes < 60) {
    return `Sisa ${totalMinutes} menit`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `Sisa ${hours} jam`;
  }
  return `Sisa ${hours} jam ${minutes} menit`;
}

/**
 * Memformat durasi keterlambatan untuk kategori `overdue`,
 * contoh: "Lewat 5 jam" atau "Lewat 2 hari".
 *
 * @param {number | null | undefined} remainingHours
 * @returns {string | null}
 */
function formatOverdueDuration(remainingHours) {
  if (typeof remainingHours !== "number" || !Number.isFinite(remainingHours) || remainingHours >= 0) {
    return null;
  }
  const elapsedMinutes = Math.max(1, Math.round(Math.abs(remainingHours) * 60));
  if (elapsedMinutes < 60) {
    return `Lewat ${elapsedMinutes} menit`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `Lewat ${elapsedHours} jam`;
  }
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Lewat ${elapsedDays} hari`;
}

/**
 * Mendapatkan label mata kuliah (`KODE • Nama` atau nama saja).
 *
 * @param {object | string | null | undefined} course
 * @returns {string}
 */
function formatCourseLabel(course) {
  if (!course) return "";
  if (typeof course === "string") return course;
  const parts = [course.kode, course.name].filter(Boolean);
  return parts.join(" • ");
}

/**
 * Card satu tugas pada halaman Daftar Tugas.
 * Merender 4 kondisi visual berbeda sesuai PRD.md Section 4.2:
 * 1. `mendekati_deadline` (+ highlight khusus jika `ai_priority.is_top_ai_pick === true`)
 * 2. `overdue`
 * 3. `normal`
 * 4. `selesai`
 *
 * @param {object} props
 * @param {object} props.task Data tugas dari API.
 * @param {(task: object) => void} props.onToggleStatus Dipanggil saat tombol status ditekan.
 * @param {(id: number) => void} props.onDelete Dipanggil saat tombol hapus ditekan.
 * @param {boolean} [props.isUpdating] Menandakan status tugas ini sedang diperbarui.
 * @param {boolean} [props.isDeleting] Menandakan tugas ini sedang dihapus.
 */
export default function TaskCard({
  task,
  onToggleStatus,
  onDelete,
  isUpdating = false,
  isDeleting = false
}) {
  const urgency =
    task.status === "selesai"
      ? "selesai"
      : task.urgency_category || "normal";

  const isNearDeadline = urgency === "mendekati_deadline";
  const isOverdue = urgency === "overdue";
  const isCompleted = urgency === "selesai";

  const aiPriority = isNearDeadline ? task.ai_priority : null;
  const isTopAiPick = Boolean(aiPriority?.is_top_ai_pick);
  const aiReason = aiPriority?.reason || null;
  const complexityScore =
    aiPriority && typeof aiPriority.complexity_score === "number"
      ? aiPriority.complexity_score
      : null;

  const isBusy = isUpdating || isDeleting;
  const courseLabel = formatCourseLabel(task.mata_kuliah);
  const overdueDuration = isOverdue ? formatOverdueDuration(task.remaining_hours) : null;

  const cardClasses = [
    "card",
    "task-card",
    `task-card--${urgency}`,
    isTopAiPick ? "task-card--top-ai" : "",
    isBusy ? "task-card--busy" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClasses} data-urgency={urgency} data-top-ai={isTopAiPick ? "true" : "false"}>
      <div className="task-card__main">
        {/* Baris Badge Urgensi & Status */}
        <div className="task-card__badges">
          {isNearDeadline && (
            <span className="badge badge--near-deadline">
              <span className="badge__dot" aria-hidden="true" />
              Mendekati Deadline • {formatRemainingCountdown(task.remaining_hours)}
            </span>
          )}

          {isTopAiPick && (
            <span className="badge badge--ai-top">
              <span aria-hidden="true">✦</span> Prioritas Utama AI
            </span>
          )}

          {isOverdue && (
            <span className="badge badge--overdue">
              Terlambat (Overdue){overdueDuration ? ` • ${overdueDuration}` : ""}
            </span>
          )}

          {!isNearDeadline && !isOverdue && (
            <span className={`badge ${isCompleted ? "selesai" : "belum"}`}>
              {isCompleted ? "Selesai" : "Belum"}
            </span>
          )}
        </div>

        {/* Judul & Mata Kuliah */}
        <h3 className={`task-card__title ${isCompleted ? "task-card__title--completed" : ""}`}>
          {task.judul}
        </h3>

        <div className="task-card__meta-row">
          {courseLabel && <span className="task-card__course">{courseLabel}</span>}
          <span className={`task-card__deadline ${isOverdue ? "task-card__deadline--overdue" : ""}`}>
            Deadline: {formatDeadline(task.deadline)}
          </span>
        </div>

        {task.deskripsi && <p className="task-card__desc">{task.deskripsi}</p>}

        {/* Kotak Penjelasan Alasan AI untuk Prioritas Utama */}
        {isTopAiPick && aiReason && (
          <div className="ai-insight-banner" role="note" aria-label="Rekomendasi Prioritas AI">
            <div className="ai-insight-banner__header">
              <span className="ai-insight-banner__label">✦ Analisis Prioritas AI</span>
              {complexityScore !== null && (
                <span className="ai-insight-banner__score">
                  Kompleksitas {complexityScore}/10
                </span>
              )}
            </div>
            <p className="ai-insight-banner__text">{aiReason}</p>
          </div>
        )}

        {/* Catatan AI ringkas untuk tugas mendekati deadline lainnya (jika ada hasil triage) */}
        {isNearDeadline && !isTopAiPick && aiReason && (
          <div className="ai-insight-note">
            <span className="ai-insight-note__tag">
              AI{complexityScore !== null ? ` (${complexityScore}/10)` : ""}:
            </span>{" "}
            {aiReason}
          </div>
        )}
      </div>

      {/* Kolom Aksi */}
      <div className="task-card__actions">
        <button
          type="button"
          className={`btn btn--sm ${isCompleted ? "btn--secondary" : "btn--primary"}`}
          onClick={() => onToggleStatus(task)}
          disabled={isBusy}
        >
          {isUpdating
            ? "Memperbarui..."
            : isCompleted
              ? "Tandai Belum"
              : "Tandai Selesai"}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--danger-outline"
          onClick={() => onDelete(task.id)}
          disabled={isBusy}
        >
          {isDeleting ? "Menghapus..." : "Hapus"}
        </button>
      </div>
    </article>
  );
}
