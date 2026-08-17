import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const newOpaqueToken = () => crypto.randomBytes(48).toString('base64url');
export const signAccessToken = (user) => jwt.sign({ sub: user._id.toString(), email: user.email }, env.accessSecret, { expiresIn: env.accessTtl });
export const signRefreshToken = (user, familyId) => jwt.sign({ sub: user._id.toString(), familyId }, env.refreshSecret, { expiresIn: `${env.refreshTtlDays}d` });
export const verifyAccessToken = (token) => jwt.verify(token, env.accessSecret);
export const verifyRefreshToken = (token) => jwt.verify(token, env.refreshSecret);
export const refreshCookieOptions = () => ({ httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/api/v1/auth', maxAge: env.refreshTtlDays * 24 * 60 * 60 * 1000 });
