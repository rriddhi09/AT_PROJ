import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { clearRefreshCookieOptions, refreshCookieOptions, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(128) });
const registerInput = credentials.extend({ name: z.string().trim().min(2).max(80) });
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email });

function issueSession(res, user) {
  const refreshToken = signRefreshToken(user);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return { accessToken: signAccessToken(user), user: publicUser(user) };
}

export const register = asyncHandler(async (req, res) => {
  const input = registerInput.parse(req.body);
  const user = await User.create({ name: input.name, email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12) });
  res.status(201).json(issueSession(res, user));
});

export const login = asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase(), deletedAt: null }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
  res.json(issueSession(res, user));
});

export async function refresh(req, res, next) { try {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ message: 'Refresh token missing.' });
  const payload = verifyRefreshToken(token);
  const user = await User.findOne({ _id: payload.sub, deletedAt: null });
  if (!user) return res.status(401).json({ message: 'Account unavailable.' });
  res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
} catch (error) { res.clearCookie('refreshToken', clearRefreshCookieOptions()); next(error); } }

export function logout(req, res) { res.clearCookie('refreshToken', clearRefreshCookieOptions()).status(204).end(); }
