/**
 * Konfigurasi backend yang dibaca dari environment (file `.env`).
 *
 * `dotenv/config` harus di-import paling awal. Dengan begitu isi `.env` sudah
 * terbaca sebelum modul lain (route dan middleware) membaca `process.env`.
 */
import "dotenv/config";

export const PORT = process.env.PORT || 4000;

// Nilai bawaan hanya untuk pengembangan lokal. Ganti sebelum aplikasi di-deploy.
export const JWT_SECRET = process.env.JWT_SECRET || "studytrack-secret-key-change-this";

export const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/studytrack";

export const DB_SSL =
  process.env.DB_SSL === "true" ||
  DATABASE_URL.includes("sslmode=require") ||
  DATABASE_URL.includes("neon.tech") ||
  DATABASE_URL.includes("supabase.co");
