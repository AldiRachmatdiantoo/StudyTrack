/**
 * Data seed StudyTrack:
 * - 1 akun demo (`demo@studytrack.test` / `demo1234`)
 * - 3 mata kuliah resmi dari guidebook (CS 186, CS 61B, CS 169)
 * - 3 tugas resmi guidebook dengan deadline dinamis (UTC) + 2 tugas uji
 *   agar seluruh kategori (`mendekati_deadline`, `overdue`, `normal`, `selesai`)
 *   langsung tersedia untuk pengujian.
 */
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import { initDB, pool } from "../db.js";

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Mengosongkan tabel dan mengisi ulang data seed awal.
 */
export async function resetAndSeedDB() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE TABLE tugas, mata_kuliah, users RESTART IDENTITY CASCADE");

    const passwordHash = await bcrypt.hash("demo1234", 10);
    const userRes = await client.query(
      `INSERT INTO users (nama, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["Demo Mahasiswa", "demo@studytrack.test", passwordHash]
    );
    const userId = userRes.rows[0].id;

    const coursesData = [
      { name: "Database Systems", kode: "CS 186", dosen: "Dr. Andi Wijaya" },
      { name: "Data Structures", kode: "CS 61B", dosen: "Dr. Sari Lestari" },
      { name: "Software Engineering", kode: "CS 169", dosen: "Dr. Budi Santoso" }
    ];

    const courseIds = {};
    for (const c of coursesData) {
      const res = await client.query(
        `INSERT INTO mata_kuliah (name, kode, dosen, user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [c.name, c.kode, c.dosen, userId]
      );
      courseIds[c.kode] = res.rows[0].id;
    }

    const tasksData = [
      {
        mata_kuliah_id: courseIds["CS 186"],
        judul: "Lab 4: Query Optimization Report",
        deskripsi: "Laporan hasil eksperimen optimasi query beserta analisis query plan.",
        deadline: hoursFromNow(18),
        status: "belum",
        created_at: hoursFromNow(-72)
      },
      {
        mata_kuliah_id: courseIds["CS 61B"],
        judul: "Project 3: BSTMap Implementation",
        deskripsi:
          "Implementasi Binary Search Tree Map (insert, delete, rebalance, iterator) beserta unit test komprehensif dan analisis kompleksitas waktu.",
        deadline: hoursFromNow(14),
        status: "belum",
        created_at: hoursFromNow(-48)
      },
      {
        mata_kuliah_id: courseIds["CS 169"],
        judul: "Sprint 2: Backend API Integration",
        deskripsi: "Integrasi endpoint backend ke frontend untuk sprint 2.",
        deadline: hoursFromNow(72),
        status: "belum",
        created_at: hoursFromNow(-24)
      },
      {
        mata_kuliah_id: courseIds["CS 186"],
        judul: "Lab 3: B+ Tree Indexing",
        deskripsi: "Implementasi operasi split dan merge node pada indeks B+ Tree.",
        deadline: hoursFromNow(-5),
        status: "belum",
        created_at: hoursFromNow(-96)
      },
      {
        mata_kuliah_id: courseIds["CS 61B"],
        judul: "Quiz 1: Asymptotic Analysis",
        deskripsi: "Latihan soal analisis Big-O, Theta, dan Omega untuk algoritma rekursif.",
        deadline: hoursFromNow(4),
        status: "selesai",
        created_at: hoursFromNow(-120)
      }
    ];

    for (const t of tasksData) {
      await client.query(
        `INSERT INTO tugas (judul, deskripsi, deadline, status, mata_kuliah_id, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [t.judul, t.deskripsi, t.deadline, t.status, t.mata_kuliah_id, userId, t.created_at]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mengisi data seed otomatis jika tabel `users` masih kosong.
 */
export async function ensureSeeded() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (rows[0].count === 0) {
    await resetAndSeedDB();
    return true;
  }
  return false;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  try {
    await initDB();
    await resetAndSeedDB();
    console.log("Seed data StudyTrack berhasil dimasukkan ke PostgreSQL.");
  } catch (err) {
    console.error("Gagal menjalankan seed database:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
