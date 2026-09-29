import { Router } from 'express';
import { createProblem, executeProblem, getProblem, listProblems } from '../controllers/problemController.js';
import { authenticate } from '../middleware/authenticate.js';
export const problemRouter = Router();
problemRouter.use(authenticate);
problemRouter.get('/:meetingCode/problems', listProblems);
problemRouter.post('/:meetingCode/problems', createProblem);
problemRouter.get('/:meetingCode/problems/:problemId', getProblem);
problemRouter.post('/:meetingCode/problems/:problemId/execute', executeProblem);
