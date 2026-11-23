# QA Verification Matrix — StudyTrack (Smart Deadline Reminder & AI Complexity Triage)

Dokumen ini merangkum hasil pengujian fungsional, negatif, edge case, dan integrasi PostgreSQL untuk **Modul 4** sesuai `PRD.md` dan `PROGRESS.md` (siap digunakan sebagai bahan **Slide Deck PDF** & **Video Assessment**).

- **Tanggal Pengujian:** 2026-11-23
- **Suite Otomatis:** `backend/tests/aiPrioritizer.test.js`, `backend/tests/deadlineOrdering.test.js`, `backend/tests/qaMatrix.test.js`
- **Perintah Verifikasi:** `cd backend && npm test`
- **Status Keseluruhan:** **19 / 19 PASSED (0 FAILED)**

---

## Ringkasan Skenario Pengujian (Modul 4)

| ID | Jenis | Skenario Uji | Input / Kondisi | Ekspektasi (`PRD.md`) | Hasil Aktual | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-01** | **Positif** | Tugas mendekati deadline (< 24 jam) | Tugas `status = 'belum'`, sisa waktu **10 jam** dibanding tugas `overdue` (-4 jam) & `normal` (72 jam) | Masuk urutan paling atas (Bucket 1), `urgency_category = "mendekati_deadline"`, `remaining_hours = 10` | Posisi #1: *"Lab 4: Query Optimization Report"* (`mendekati_deadline`, `remaining_hours: 10`), diikuti `overdue`, lalu `normal` | **PASS** |
| **TC-02** | **Positif (AI Triage)** | 2 tugas sama-sama sisa < 24 jam | *Lab 4: Query Optimization Report* (sisa 10 jam) vs *Project 3: BSTMap Implementation* (sisa 16 jam, jauh lebih rumit) | AI Triage menilai kompleksitas & mengangkat *BSTMap* ke posisi **#1** dengan `is_top_ai_pick: true`, `complexity_score` lebih tinggi, dan `ai_priority.reason` terisi | #1: *"Project 3: BSTMap Implementation"* (`score: 9`, `is_top_ai_pick: true`) mengungguli *"Lab 4: Query Optimization Report"* (`score: 5`), lengkap dengan alasan AI | **PASS** |
| **TC-03** | **Negatif** | Tugas masih jauh dari deadline | Tugas `status = 'belum'`, sisa waktu **48 jam** | Masuk Bucket 3 (`urgency_category = "normal"`), tanpa badge urgensi dan `ai_priority = null` | `urgency_category: "normal"`, `remaining_hours: 48`, `ai_priority: null` | **PASS** |
| **TC-04** | **Negatif (Status Selesai)** | Tugas mepet / lewat deadline tetapi sudah `selesai` | Tugas A sisa **2 jam** (`status = 'selesai'`) & Tugas B lewat **3 jam** (`status = 'selesai'`) bersama 1 tugas `normal` (`belum`) | Tidak memicu `mendekati_deadline` maupun `overdue`; masuk Bucket 4 (`selesai`) di bawah tugas `normal`, `ai_priority = null` | Urutan: `[normal, selesai, selesai]` — tidak ada penanda peringatan | **PASS** |
| **TC-05** | **Edge Case** | Batas presisi 24 jam & 0 detik (UTC vs WIB) | Sisa tepat **24j 00m 00d**, **23j 59m 59d**, **0 detik**, dan **lewat 1 menit (-60d)** | `24j00m` -> `normal`; `23j59m59d` -> `mendekati_deadline`; `0d` -> `mendekati_deadline`; `-1m` -> `overdue` | `24j00m = normal`, `23j59m59d = mendekati_deadline`, `0d = mendekati_deadline`, `-1m = overdue` (konsisten UTC & WIB +07:00) | **PASS** |
| **TC-06** | **Integrasi DB & F04** | Isolasi lintas pengguna & transisi `belum` -> `selesai` | User A & User B masing-masing punya tugas mepet di PostgreSQL; tugas User A lalu diubah ke `selesai` | User A hanya melihat tugas miliknya sendiri; setelah `selesai`, urgensi hilang dan pindah ke bucket `selesai` | Isolasi User A/B terverifikasi langsung di PostgreSQL; perubahan status langsung menghapus `mendekati_deadline` | **PASS** |

---

## Validasi Tambahan (Resiliensi & Frontend Build)

- **Graceful Fallback AI:** Jika `OPENAI_API_KEY` kosong, timeout (`> 3500ms`), atau API mengembalikan error (429 / invalid JSON), sistem melakukan *silent catch* dengan log warning dan mengurutkan Bucket 1 berdasarkan `deadline ASC` dengan `ai_priority.reason = null` (**PASS**).
- **In-Memory Cache AI:** Refresh halaman dengan daftar tugas Bucket 1 yang identik tidak memanggil OpenAI API berulang kali; perubahan judul/deskripsi/deadline otomatis menginvalidasi cache (**PASS**).
- **Frontend Production Build:** `cd frontend && npm run build` berhasil tanpa error maupun warning fatal.
