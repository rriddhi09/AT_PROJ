import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAccessToken } from '../../lib/api';
const AuthContext = createContext(null);
const refreshKey = 'auth-refresh-token';
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true);
  const applySession = useCallback((session) => { setAccessToken(session.accessToken); setUser(session.user); if (session.refreshToken) sessionStorage.setItem(refreshKey, session.refreshToken); }, []);
  const restore = useCallback(async () => { const refreshToken = sessionStorage.getItem(refreshKey); if (!refreshToken) return false; const { data } = await api.post('/auth/refresh', { refreshToken }); applySession(data); return true; }, [applySession]);
  useEffect(() => { restore().catch(() => { sessionStorage.removeItem(refreshKey); setAccessToken(null); setUser(null); }).finally(() => setLoading(false)); }, [restore]);
  useEffect(() => { if (!user) return undefined; const timer = setInterval(() => restore().catch(() => {}), 10 * 60 * 1000); return () => clearInterval(timer); }, [restore, user]);
  const login = async (values) => { const { data } = await api.post('/auth/login', values); applySession(data); };
  const register = async (values) => { const { data } = await api.post('/auth/register', values); applySession(data); };
  const logout = async () => { try { await api.post('/auth/logout'); } finally { sessionStorage.removeItem(refreshKey); setAccessToken(null); setUser(null); } };
  return <AuthContext.Provider value={{ user, loading, login, register, logout, accessToken: api.defaults.headers.common.Authorization?.slice(7) ?? null }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
