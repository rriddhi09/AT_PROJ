import { Router } from 'express';
import { googleSignIn, linkGoogle, login, logout, refresh, register, updateProfile } from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

export const authRouter = Router();
authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', logout);
authRouter.post('/google', googleSignIn);
authRouter.post('/google/link', authenticate, linkGoogle);
authRouter.patch('/profile', authenticate, updateProfile);
