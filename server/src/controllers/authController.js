import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { User } from '../models/User.js';
import { env } from '../config/env.js';
import { clearRefreshCookieOptions, refreshCookieOptions, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/tokens.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(128) });
const registerInput = credentials.extend({ name: z.string().trim().min(2).max(80) });
const profileInput = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), currentPassword: z.string().optional(), newPassword: z.string().min(8).max(128).optional() });
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, googleConnected: Boolean(user.googleSub), hasPassword: Boolean(user.passwordHash) });
const googleClient = new OAuth2Client();

async function googleIdentity(credential) {
  if (!env.googleClientId) return null;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    const identity = ticket.getPayload();
    return identity?.sub && identity?.email && identity.email_verified ? identity : null;
  } catch { return null; }
}

function issueSession(res, user) {
  const refreshToken = signRefreshToken(user);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions());
  return { accessToken: signAccessToken(user), refreshToken, user: publicUser(user) };
}

export const register = asyncHandler(async (req, res) => {
  const input = registerInput.parse(req.body);
  const user = await User.create({ name: input.name, email: input.email.toLowerCase(), passwordHash: await bcrypt.hash(input.password, 12) });
  res.status(201).json(issueSession(res, user));
});

export const login = asyncHandler(async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase(), deletedAt: null }).select('+passwordHash +googleSub');
  if (!user?.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
  res.json(issueSession(res, user));
});

export async function refresh(req, res, next) { try {
  const token = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {}).refreshToken ?? req.cookies.refreshToken;
  if (!token) return res.status(401).json({ message: 'Refresh token missing.' });
  const payload = verifyRefreshToken(token);
  const user = await User.findOne({ _id: payload.sub, deletedAt: null }).select('+googleSub +passwordHash');
  if (!user) return res.status(401).json({ message: 'Account unavailable.' });
  res.json(issueSession(res, user));
} catch (error) { res.clearCookie('refreshToken', clearRefreshCookieOptions()); next(error); } }

export function logout(req, res) { res.clearCookie('refreshToken', clearRefreshCookieOptions()).status(204).end(); }

export const googleSignIn = asyncHandler(async (req, res) => {
  if (!env.googleClientId) return res.status(503).json({ message: 'Google sign-in is not configured yet.' });
  const { credential } = z.object({ credential: z.string().min(1) }).parse(req.body);
  const identity = await googleIdentity(credential);
  if (!identity) return res.status(401).json({ message: 'Google sign-in could not be verified. Please try again.' });
  let user = await User.findOne({ googleSub: identity.sub, deletedAt: null }).select('+googleSub +passwordHash');
  if (!user) {
    const email = identity.email.toLowerCase();
    if (await User.exists({ email, deletedAt: null })) return res.status(409).json({ code: 'LINK_REQUIRED', message: 'This email already has an account. Sign in with your password, then link Google in your profile.' });
    const name = identity.name?.trim().slice(0, 80);
    user = await User.create({ name: name?.length >= 2 ? name : 'Google user', email, googleSub: identity.sub });
  }
  res.json(issueSession(res, user));
});

export const linkGoogle = asyncHandler(async (req, res) => {
  if (!env.googleClientId) return res.status(503).json({ message: 'Google sign-in is not configured yet.' });
  const { credential } = z.object({ credential: z.string().min(1) }).parse(req.body);
  const identity = await googleIdentity(credential);
  if (!identity) return res.status(401).json({ message: 'Google account could not be verified. Please try again.' });
  const user = await User.findById(req.user._id).select('+googleSub +passwordHash');
  if (user.googleSub) return res.status(409).json({ message: 'A Google account is already linked to this profile.' });
  if (identity.email.toLowerCase() !== user.email) return res.status(409).json({ message: 'Choose the Google account with the same email as this profile.' });
  if (await User.exists({ googleSub: identity.sub, _id: { $ne: user._id } })) return res.status(409).json({ message: 'That Google account is linked to another profile.' });
  user.googleSub = identity.sub;
  await user.save();
  res.json({ user: publicUser(user) });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const input = profileInput.parse(req.body);
  const user = await User.findById(req.user._id).select('+passwordHash +googleSub');
  if (input.newPassword && user.passwordHash && (!input.currentPassword || !(await bcrypt.compare(input.currentPassword, user.passwordHash)))) return res.status(400).json({ message: 'Current password is incorrect.' });
  const email = input.email.toLowerCase();
  if (email !== user.email && await User.exists({ email, deletedAt: null, _id: { $ne: user._id } })) return res.status(409).json({ message: 'This email address is already in use.' });
  user.name = input.name; user.email = email;
  if (input.newPassword) user.passwordHash = await bcrypt.hash(input.newPassword, 12);
  await user.save();
  res.json(issueSession(res, user));
});
