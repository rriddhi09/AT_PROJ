import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/authenticate.js';
import { listFiles, uploadFile } from '../controllers/fileController.js';
export const fileRouter = Router();
fileRouter.use(authenticate);
fileRouter.get('/:meetingCode/files', listFiles);
fileRouter.post('/:meetingCode/files', rateLimit({ windowMs: 60 * 1000, limit: 10 }), uploadFile);
