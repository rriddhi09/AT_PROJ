import { Router } from 'express';
import { login, logout, refresh, register } from '../controllers/authController.js';

export const authRouter = Router();
authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', logout);
