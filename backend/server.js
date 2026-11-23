/**
 * Entry point server lokal / Node persistent (Render, Railway, lokal).
 */
import { PORT } from "./config.js";
import app, { ensureInitialized } from "./app.js";

async function startServer() {
  try {
    await ensureInitialized();
    app.listen(PORT, () => {
      console.log(`StudyTrack backend berjalan di http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Gagal memulai StudyTrack backend:", err.message);
    process.exit(1);
  }
}

startServer();
