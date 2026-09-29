import axios from 'axios';
const localApi = `http://${window.location.hostname}:5000/api/v1`;
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? localApi, withCredentials: true });
export function setAccessToken(token) { if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`; else delete api.defaults.headers.common.Authorization; }
