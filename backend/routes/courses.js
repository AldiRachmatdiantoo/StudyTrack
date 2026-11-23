import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

/**
 * GET /api/courses
 */
router.get("/", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id, user_id, name, kode, dosen FROM mata_kuliah WHERE user_id = $1 ORDER BY id ASC",
      [req.user.id]
    );
    res.json({ courses: rows });
  } catch (err) {
    console.error("Get courses error:", err);
    res.status(500).json({ error: "Gagal memuat daftar mata kuliah." });
  }
});

/**
 * POST /api/courses
 */
router.post("/", async (req, res) => {
  try {
    const { name, kode, dosen } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Nama mata kuliah wajib diisi." });
    }

    const { rows } = await query(
      `INSERT INTO mata_kuliah (user_id, name, kode, dosen)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name, kode, dosen`,
      [req.user.id, name.trim(), (kode || "").trim(), (dosen || "").trim()]
    );
    res.status(201).json({ course: rows[0] });
  } catch (err) {
    console.error("Create course error:", err);
    res.status(500).json({ error: "Gagal menambahkan mata kuliah." });
  }
});

/**
 * PUT /api/courses/:id
 */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "ID mata kuliah tidak valid." });
    }

    const existing = await query(
      "SELECT id, user_id, name, kode, dosen FROM mata_kuliah WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Mata kuliah tidak ditemukan." });
    }

    const current = existing.rows[0];
    const name = req.body.name !== undefined ? req.body.name : current.name;
    const kode = req.body.kode !== undefined ? req.body.kode : current.kode;
    const dosen = req.body.dosen !== undefined ? req.body.dosen : current.dosen;

    const { rows } = await query(
      `UPDATE mata_kuliah
       SET name = $1, kode = $2, dosen = $3
       WHERE id = $4 AND user_id = $5
       RETURNING id, user_id, name, kode, dosen`,
      [name, kode, dosen, id, req.user.id]
    );
    res.json({ course: rows[0] });
  } catch (err) {
    console.error("Update course error:", err);
    res.status(500).json({ error: "Gagal memperbarui mata kuliah." });
  }
});

/**
 * DELETE /api/courses/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "ID mata kuliah tidak valid." });
    }

    const { rowCount } = await query(
      "DELETE FROM mata_kuliah WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Mata kuliah tidak ditemukan." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete course error:", err);
    res.status(500).json({ error: "Gagal menghapus mata kuliah." });
  }
});

export default router;
