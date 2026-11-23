import React, { useEffect, useMemo, useState } from "react";
import api from "../api.js";
import Navbar from "../components/Navbar.jsx";
import TaskCard from "../components/TaskCard.jsx";

/**
 * Halaman Daftar Tugas: form tambah tugas, ringkasan urgensi, dan daftar seluruh
 * tugas pengguna lintas mata kuliah sesuai urutan prioritas dari backend.
 */
export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState("");
  const [judul, setJudul] = useState("");
  const [deskripsi, setDeskripsi] = useState("");
  const [deadline, setDeadline] = useState("");

  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState(null);
  const [deletingTaskId, setDeletingTaskId] = useState(null);

  async function loadData({ initial = false } = {}) {
    if (initial) {
      setIsInitialLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setLoadError("");

    try {
      const [tasksRes, coursesRes] = await Promise.all([
        api.get("/tasks"),
        api.get("/courses")
      ]);
      setTasks(tasksRes.data.tasks || []);
      setCourses(coursesRes.data.courses || []);
    } catch (err) {
      setLoadError(err.response?.data?.error || "Gagal memuat daftar tugas. Coba lagi.");
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }

  async function refreshTasksOnly() {
    setIsRefreshing(true);
    setLoadError("");
    try {
      const tasksRes = await api.get("/tasks");
      setTasks(tasksRes.data.tasks || []);
    } catch (err) {
      setLoadError(err.response?.data?.error || "Gagal menyinkronkan daftar tugas.");
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    loadData({ initial: true });
  }, []);

  const summary = useMemo(() => {
    const counts = {
      mendekati_deadline: 0,
      overdue: 0,
      normal: 0,
      selesai: 0
    };
    for (const t of tasks) {
      const cat = t.status === "selesai" ? "selesai" : t.urgency_category || "normal";
      if (counts[cat] !== undefined) {
        counts[cat] += 1;
      }
    }
    return counts;
  }, [tasks]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!courseId) {
      setError("Pilih mata kuliah terlebih dahulu.");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post("/tasks", { mata_kuliah_id: courseId, judul, deskripsi, deadline });
      setJudul("");
      setDeskripsi("");
      setDeadline("");
      await refreshTasksOnly();
    } catch (err) {
      setError(err.response?.data?.error || "Gagal menambahkan tugas.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleStatus(task) {
    const newStatus = task.status === "selesai" ? "belum" : "selesai";
    setUpdatingTaskId(task.id);
    setLoadError("");
    try {
      await api.put(`/tasks/${task.id}`, { status: newStatus });
      await refreshTasksOnly();
    } catch (err) {
      setLoadError(err.response?.data?.error || "Gagal memperbarui status tugas.");
    } finally {
      setUpdatingTaskId(null);
    }
  }

  async function handleDelete(id) {
    setDeletingTaskId(id);
    setLoadError("");
    try {
      await api.delete(`/tasks/${id}`);
      await refreshTasksOnly();
    } catch (err) {
      setLoadError(err.response?.data?.error || "Gagal menghapus tugas.");
    } finally {
      setDeletingTaskId(null);
    }
  }

  return (
    <>
      <Navbar />
      <main className="container">
        <div className="page-header">
          <div>
            <h1>Daftar Tugas</h1>
            <p className="page-subtitle">
              Diurutkan otomatis berdasarkan urgensi deadline &amp; analisis kompleksitas AI.
            </p>
          </div>
          {isRefreshing && !isInitialLoading && (
            <div className="sync-indicator" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span>Memperbarui urutan...</span>
            </div>
          )}
        </div>

        <section className="card form-card" aria-label="Tambah Tugas Baru">
          <h2>Tambah Tugas</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                required
                disabled={isSubmitting}
              >
                <option value="">-- Pilih Mata Kuliah --</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kode ? `${c.kode} — ${c.name}` : c.name}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
                disabled={isSubmitting}
                aria-label="Deadline tugas (WIB)"
              />
            </div>

            <input
              type="text"
              placeholder="Judul Tugas"
              value={judul}
              onChange={(e) => setJudul(e.target.value)}
              required
              disabled={isSubmitting}
            />
            <textarea
              placeholder="Deskripsi tugas (semakin detail, semakin akurat analisis kompleksitas AI)"
              value={deskripsi}
              onChange={(e) => setDeskripsi(e.target.value)}
              rows={2}
              disabled={isSubmitting}
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menyimpan..." : "Tambah Tugas"}
            </button>
          </form>
        </section>

        {/* Ringkasan kategori urgensi */}
        {!isInitialLoading && tasks.length > 0 && (
          <div className="urgency-summary" aria-label="Ringkasan status tugas">
            <div className="summary-pill summary-pill--near">
              <span className="summary-pill__count">{summary.mendekati_deadline}</span>
              <span className="summary-pill__label">Mendekati Deadline</span>
            </div>
            <div className="summary-pill summary-pill--overdue">
              <span className="summary-pill__count">{summary.overdue}</span>
              <span className="summary-pill__label">Terlambat</span>
            </div>
            <div className="summary-pill summary-pill--normal">
              <span className="summary-pill__count">{summary.normal}</span>
              <span className="summary-pill__label">Belum</span>
            </div>
            <div className="summary-pill summary-pill--done">
              <span className="summary-pill__count">{summary.selesai}</span>
              <span className="summary-pill__label">Selesai</span>
            </div>
          </div>
        )}

        {loadError && (
          <div className="alert-error" role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={() => loadData({ initial: tasks.length === 0 })}
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* Indikator loading awal (Skeleton Cards) */}
        {isInitialLoading && (
          <div className="skeleton-list" aria-busy="true" aria-label="Memuat daftar tugas">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card skeleton-card">
                <div className="skeleton-line skeleton-line--badge" />
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line skeleton-line--meta" />
                <div className="skeleton-line skeleton-line--desc" />
              </div>
            ))}
          </div>
        )}

        {!isInitialLoading && tasks.length === 0 && !loadError && (
          <div className="card empty-state">
            <p>Belum ada tugas. Tambahkan tugas pertama Anda di atas.</p>
          </div>
        )}

        {!isInitialLoading && tasks.length > 0 && (
          <section className="task-list" aria-label="Daftar Tugas">
            {tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                onToggleStatus={handleToggleStatus}
                onDelete={handleDelete}
                isUpdating={updatingTaskId === t.id}
                isDeleting={deletingTaskId === t.id}
              />
            ))}
          </section>
        )}
      </main>
    </>
  );
}
