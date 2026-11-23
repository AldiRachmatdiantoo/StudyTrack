import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db.js";
import { JWT_SECRET } from "../config.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, nama: user.nama, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/**
 * POST /api/auth/register
 */
router.post("/register", async (req, res) => {
  try {
    const { nama, email, password } = req.body;

    if (!nama || !email || !password) {
      return res.status(400).json({ error: "Nama, email, dan password wajib diisi." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password minimal 6 karakter." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await query("SELECT id FROM users WHERE LOWER(email) = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Email sudah terdaftar." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (nama, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, nama, email`,
      [nama.trim(), normalizedEmail, passwordHash]
    );

    const newUser = rows[0];
    const token = signToken(newUser);
    res.status(201).json({ token, user: newUser });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Terjadi kesalahan saat mendaftarkan akun." });
  }
});

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password wajib diisi." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await query(
      "SELECT id, nama, email, password_hash FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email atau password salah." });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, nama: user.nama, email: user.email }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Terjadi kesalahan saat login." });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
