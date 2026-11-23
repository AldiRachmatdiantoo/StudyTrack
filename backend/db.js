/**
 * Koneksi PostgreSQL, inisialisasi skema, dan helper query untuk StudyTrack.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { DATABASE_URL, DB_SSL } from "./config.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "db", "schema.sql");

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false
});

/**
 * Menjalankan query SQL terparameterisasi.
 *
 * @param {string} text SQL query
 * @param {Array} [params] Parameter query
 */
export function query(text, params = []) {
  return pool.query(text, params);
}

/**
 * Mengonversi input deadline menjadi string ISO 8601 UTC.
 * Jika input datang dari `datetime-local` tanpa zona waktu (mis. "2026-07-03T23:59"),
 * diasumsikan sebagai WIB (Asia/Jakarta, UTC+07:00).
 *
 * @param {string} value
 * @returns {string} ISO 8601 UTC string
 */
export function normalizeDeadlineToUtc(value) {
  if (!value) return value;
  const trimmed = String(value).trim();
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const date = new Date(hasTimezone ? trimmed : `${trimmed}+07:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Format deadline tidak valid.");
  }
  return date.toISOString();
}

/**
 * Menjalankan DDL skema (`db/schema.sql`) secara idempoten.
 */
export async function initDB() {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf-8");
  await pool.query(schemaSql);
}
