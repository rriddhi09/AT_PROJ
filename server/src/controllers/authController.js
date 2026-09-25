import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { env } from '../config/env.js';
import { hashToken, refreshCookieOptions, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/tokens.js';

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(128) });
const registerInput = credentials.extend({ name: z.string().trim().min(2).max(80) });
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, accountStatus: user.accountStatus });
const clientInfo = (req) => ({ userAgent: req.get('user-agent') ?? '', ip: req.ip });

async function issueSession(res, req, user, familyId = crypto.randomUUID()) {
  const refreshToken = signRefreshToken(user, familyId);
  await RefreshToken.create({ userId: user._id, tokenHash: hashToken(refreshToken), familyId, device: clientInfo(req), expiresAt: new Date(Date.now() + env.refreshTtlDays * 86400000) });
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return { accessToken: signAccessToken(user), user: publicUser(user) };
}

export async function register(req, res, next) { try {
  const input = registerInput.parse(req.body);
  const user = await User.create({ name: input.name, email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12) });
  res.status(201).json(await issueSession(res, req, user));
} catch (error) { next(error); } }

export async function login(req, res, next) { try {
  const input = credentials.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase(), deletedAt: null }).select('+passwordHash');
  if (!user || user.accountStatus !== 'active' || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
  user.lastLoginAt = new Date(); await user.save();
  res.json(await issueSession(res, req, user));
} catch (error) { next(error); } }

export async function refresh(req, res, next) { try {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ message: 'Refresh token missing.' });
  const payload = verifyRefreshToken(token);
  const stored = await RefreshToken.findOne({ tokenHash: hashToken(token), userId: payload.sub, familyId: payload.familyId, revokedAt: null, expiresAt: { $gt: new Date() } });
  if (!stored) return res.status(401).json({ message: 'Refresh token invalid.' });
  const user = await User.findOne({ _id: payload.sub, accountStatus: 'active', deletedAt: null });
  if (!user) return res.status(401).json({ message: 'Account unavailable.' });
  // Keep the existing refresh token valid across browser tabs and ordinary page reloads.
  // Rotation is intentionally reserved for an explicit new login or logout in this simple local app.
  res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
} catch (error) { res.clearCookie('refreshToken', refreshCookieOptions()); next(error); } }

export async function logout(req, res, next) { try {
  const token = req.cookies.refreshToken;
  if (token) await RefreshToken.updateOne({ tokenHash: hashToken(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
  res.clearCookie('refreshToken', refreshCookieOptions()); res.status(204).end();
} catch (error) { next(error); } }

export function me(req, res) { res.json({ user: publicUser(req.user) }); }
