import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, refresh, register } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

export const authRouter = Router();
const credentialLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many attempts. Please try again later.' } });
authRouter.post('/register', credentialLimiter, register);
authRouter.post('/login', credentialLimiter, login);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', logout);
authRouter.get('/me', authenticate, me);
