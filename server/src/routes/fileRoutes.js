import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { downloadFile, listFiles, uploadFile } from '../controllers/fileController.js';
export const fileRouter = Router();
fileRouter.use(authenticate);
fileRouter.get('/:meetingCode/files', listFiles);
fileRouter.post('/:meetingCode/files', uploadFile);
fileRouter.get('/:meetingCode/files/:fileId/download', downloadFile);
