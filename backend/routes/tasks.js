import { Router } from "express";
import { query, normalizeDeadlineToUtc } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sortAndEnrichTasks } from "../services/taskOrdering.service.js";

const router = Router();

router.use(requireAuth);

/**
 * GET /api/tasks
 * Daftar seluruh tugas milik pengguna yang sedang login lintas semua mata kuliah (F04),
 * diklasifikasikan ke 4 bucket prioritas (F01–F03) dan diperkaya dengan AI Complexity Triage
 * untuk Bucket 1 (`mendekati_deadline`) jika terdapat >= 2 tugas.
 */
router.get("/", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         t.id,
         t.user_id,
         t.mata_kuliah_id,
         t.judul,
         t.deskripsi,
         t.deadline,
         t.status,
         t.created_at,
         mk.id AS mk_id,
         mk.kode AS mk_kode,
         mk.name AS mk_name
       FROM tugas t
       INNER JOIN mata_kuliah mk ON mk.id = t.mata_kuliah_id
       WHERE t.user_id = $1 AND mk.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    const tasks = await sortAndEnrichTasks(rows);
    res.json({ tasks });
  } catch (err) {
    console.error("Get tasks error:", err);
    res.status(500).json({ error: "Gagal memuat daftar tugas." });
  }
});

/**
 * GET /api/tasks/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "ID tugas tidak valid." });
    }

    const { rows } = await query(
      `SELECT id, user_id, mata_kuliah_id, judul, deskripsi, deadline, status, created_at
       FROM tugas
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }
    res.json({ task: rows[0] });
  } catch (err) {
    console.error("Get task detail error:", err);
    res.status(500).json({ error: "Gagal memuat detail tugas." });
  }
});

/**
 * POST /api/tasks
 */
router.post("/", async (req, res) => {
  try {
    const { mata_kuliah_id, judul, deskripsi, deadline } = req.body;
    if (!mata_kuliah_id || !judul || !deadline) {
      return res.status(400).json({ error: "mata_kuliah_id, judul, dan deadline wajib diisi." });
    }

    const courseId = Number(mata_kuliah_id);
    const courseRes = await query(
      "SELECT id FROM mata_kuliah WHERE id = $1 AND user_id = $2",
      [courseId, req.user.id]
    );
    if (courseRes.rows.length === 0) {
      return res.status(400).json({ error: "Mata kuliah tidak ditemukan untuk user ini." });
    }

    let deadlineUtc;
    try {
      deadlineUtc = normalizeDeadlineToUtc(deadline);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { rows } = await query(
      `INSERT INTO tugas (user_id, mata_kuliah_id, judul, deskripsi, deadline, status)
       VALUES ($1, $2, $3, $4, $5, 'belum')
       RETURNING id, user_id, mata_kuliah_id, judul, deskripsi, deadline, status, created_at`,
      [req.user.id, courseId, judul.trim(), (deskripsi || "").trim(), deadlineUtc]
    );

    res.status(201).json({ task: rows[0] });
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ error: "Gagal menambahkan tugas." });
  }
});

/**
 * PUT /api/tasks/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "ID tugas tidak valid." });
    }

    const existing = await query(
      `SELECT id, user_id, mata_kuliah_id, judul, deskripsi, deadline, status, created_at
       FROM tugas
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }

    const current = existing.rows[0];
    const { judul, deskripsi, deadline, status } = req.body;

    if (status !== undefined && !["belum", "selesai"].includes(status)) {
      return res.status(400).json({ error: "Status hanya boleh 'belum' atau 'selesai'." });
    }

    let nextDeadline = current.deadline;
    if (deadline !== undefined) {
      try {
        nextDeadline = normalizeDeadlineToUtc(deadline);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    const { rows } = await query(
      `UPDATE tugas
       SET judul = $1, deskripsi = $2, deadline = $3, status = $4
       WHERE id = $5 AND user_id = $6
       RETURNING id, user_id, mata_kuliah_id, judul, deskripsi, deadline, status, created_at`,
      [
        judul !== undefined ? judul : current.judul,
        deskripsi !== undefined ? deskripsi : current.deskripsi,
        nextDeadline,
        status !== undefined ? status : current.status,
        id,
        req.user.id
      ]
    );

    res.json({ task: rows[0] });
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ error: "Gagal memperbarui tugas." });
  }
});

/**
 * DELETE /api/tasks/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "ID tugas tidak valid." });
    }

    const { rowCount } = await query(
      "DELETE FROM tugas WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Tugas tidak ditemukan." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ error: "Gagal menghapus tugas." });
  }
});

export default router;
