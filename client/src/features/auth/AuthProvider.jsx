import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAccessToken } from '../../lib/api';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); const [loading, setLoading] = useState(true);
  const applySession = useCallback((session) => { setAccessToken(session.accessToken); setUser(session.user); }, []);
  useEffect(() => { api.post('/auth/refresh').then(({ data }) => applySession(data)).catch(() => setAccessToken(null)).finally(() => setLoading(false)); }, [applySession]);
  const login = async (values) => { const { data } = await api.post('/auth/login', values); applySession(data); };
  const register = async (values) => { const { data } = await api.post('/auth/register', values); applySession(data); };
  const logout = async () => { await api.post('/auth/logout'); setAccessToken(null); setUser(null); };
  return <AuthContext.Provider value={{ user, loading, login, register, logout, accessToken: api.defaults.headers.common.Authorization?.slice(7) ?? null }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
