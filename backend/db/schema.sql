-- Skema Database PostgreSQL StudyTrack (sesuai PRD.md Section 2)

DO $$
BEGIN
  CREATE TYPE task_status AS ENUM ('belum', 'selesai');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mata_kuliah (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  kode VARCHAR(50) NOT NULL DEFAULT '',
  dosen VARCHAR(255) NOT NULL DEFAULT '',
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mata_kuliah_user_id
  ON mata_kuliah (user_id);

CREATE TABLE IF NOT EXISTS tugas (
  id SERIAL PRIMARY KEY,
  judul VARCHAR(255) NOT NULL,
  deskripsi TEXT NOT NULL DEFAULT '',
  deadline TIMESTAMPTZ NOT NULL,
  status task_status NOT NULL DEFAULT 'belum',
  mata_kuliah_id INTEGER NOT NULL REFERENCES mata_kuliah(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index sesuai PRD.md Section 2 untuk mempercepat query lintas mata kuliah
CREATE INDEX IF NOT EXISTS idx_tugas_mk_status_deadline
  ON tugas (mata_kuliah_id, status, deadline);
