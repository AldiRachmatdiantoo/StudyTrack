/**
 * Entry point backend StudyTrack.
 *
 * Menyiapkan Express, menginisialisasi skema PostgreSQL, mendaftarkan route
 * tiap modul (auth, courses, tasks), lalu menjalankan server.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";

import { PORT } from "./config.js";
import authRoutes from "./routes/auth.js";
import courseRoutes from "./routes/courses.js";
import taskRoutes from "./routes/tasks.js";
import { initDB, query } from "./db.js";
import { ensureSeeded, resetAndSeedDB } from "./db/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST_DIR = path.resolve(__dirname, "..", "frontend", "dist");
const FRONTEND_INDEX_FILE = path.join(FRONTEND_DIST_DIR, "index.html");

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors(
    corsOrigins.length > 0
      ? { origin: corsOrigins, credentials: true }
      : undefined
  )
);
app.use(express.json());

// GET /api/health - cek status server dan koneksi PostgreSQL
app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", database: "connected", message: "StudyTrack backend is running." });
  } catch (err) {
    res.status(503).json({ status: "error", database: "disconnected", error: err.message });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/tasks", taskRoutes);

/*
 * POST /api/dev/reset - mengembalikan data ke kondisi seed awal.
 * Hanya aktif di luar mode production.
 */
if (process.env.NODE_ENV !== "production") {
  app.post("/api/dev/reset", async (req, res) => {
    try {
      await resetAndSeedDB();
      res.json({ success: true, message: "Database direset ke data seed awal." });
    } catch (err) {
      console.error("Reset DB error:", err);
      res.status(500).json({ error: "Gagal mereset database." });
    }
  });
}

// Fallback 404 khusus untuk endpoint API yang tidak terdaftar
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

// Sajikan bundle produksi frontend jika tersedia (untuk deploy fullstack 1 service di Render/Railway)
if (fs.existsSync(FRONTEND_INDEX_FILE)) {
  app.use(express.static(FRONTEND_DIST_DIR));
  app.get("*", (req, res) => {
    res.sendFile(FRONTEND_INDEX_FILE);
  });
} else {
  app.use((req, res) => {
    res.status(404).json({ error: "Endpoint tidak ditemukan." });
  });
}

async function startServer() {
  try {
    await initDB();
    const seeded = await ensureSeeded();
    if (seeded) {
      console.log("Database kosong terdeteksi — data seed awal berhasil diisi.");
    }
    app.listen(PORT, () => {
      console.log(`StudyTrack backend berjalan di http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Gagal memulai StudyTrack backend:", err.message);
    process.exit(1);
  }
}

startServer();
