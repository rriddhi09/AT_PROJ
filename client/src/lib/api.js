import axios from 'axios';
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/v1', withCredentials: true });
export function setAccessToken(token) { if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`; else delete api.defaults.headers.common.Authorization; }
