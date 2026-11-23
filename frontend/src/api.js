import axios from "axios";

/** Kunci localStorage tempat token login disimpan. */
export const TOKEN_KEY = "studytrack_token";

/**
 * Instance axios untuk seluruh pemanggilan API backend.
 * - Jika `VITE_API_URL` diisi (mis. deploy frontend terpisah di Vercel), request diarahkan ke URL backend tersebut.
 * - Jika kosong (mode development via Vite proxy atau deploy fullstack satu domain di Render/Railway), gunakan `/api`.
 */
const rawApiUrl = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
const baseURL = rawApiUrl
  ? rawApiUrl.endsWith("/api")
    ? rawApiUrl
    : `${rawApiUrl}/api`
  : "/api";

const api = axios.create({
  baseURL
});

// Menyisipkan token login ke setiap request jika tersedia.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
