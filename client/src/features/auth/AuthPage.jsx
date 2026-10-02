import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';

const demoAccounts = [
  { name: 'Riddhi', email: 'riddhi@gmail.com', password: 'riddhi@1234' },
  { name: 'Sujal', email: 'sujal@gmail.com', password: 'sujal@1234' },
  { name: 'Krish', email: 'krish@gmail.com', password: 'krish@1234' }
];

export function AuthPage() {
  const [mode, setMode] = useState('login'); const [error, setError] = useState(''); const [form, setForm] = useState({ name: '', email: '', password: '' });
  const { login, register } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  async function submit(event) { event.preventDefault(); setError(''); try { await (mode === 'login' ? login(form) : register(form)); navigate(location.state?.from || '/dashboard', { replace: true }); } catch (e) { setError(e.response?.data?.message ?? 'Unable to continue.'); } }
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">UNIFIED INTERVIEW</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p className="muted">Secure meetings and technical interviews in one workspace.</p><form onSubmit={submit}>{mode === 'register' && <label>Name<input required minLength="2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>}<label>Email<input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Password<input required type="password" minLength="8" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>{error && <p className="error">{error}</p>}<button type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</button></form>{mode === 'login' && <div className="demo-login"><p>Fill credentials for:</p><div className="demo-login-buttons">{demoAccounts.map(account => <button key={account.email} type="button" onClick={() => { setForm({ name: '', email: account.email, password: account.password }); setError(''); }}>{account.name}</button>)}</div></div>}<button className="link-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}</button></section></main>;
}
