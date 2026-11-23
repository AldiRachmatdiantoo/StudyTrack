/**
 * Script CLI untuk inisialisasi skema PostgreSQL StudyTrack.
 * Jalankan dengan: `npm run db:init`
 */
import { initDB, pool } from "../db.js";

try {
  await initDB();
  console.log("Skema database PostgreSQL (users, mata_kuliah, tugas + composite index) berhasil diinisialisasi.");
} catch (err) {
  console.error("Gagal menginisialisasi skema database:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
