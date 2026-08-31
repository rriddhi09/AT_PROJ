import { Router } from 'express';
import { createMeeting, decideJoinRequest, getMeetingByCode, joinPublicMeeting, listJoinRequests, listMyMeetings, requestPrivateAccess, revealProblem, startCoding, updateMeeting } from '../controllers/meetingController.js';
import { authenticate } from '../middleware/authenticate.js';

export const meetingRouter = Router();
meetingRouter.use(authenticate);
meetingRouter.route('/').post(createMeeting).get(listMyMeetings);
meetingRouter.patch('/by-code/:meetingCode', updateMeeting);
meetingRouter.get('/by-code/:meetingCode', getMeetingByCode);
meetingRouter.post('/by-code/:meetingCode/join', joinPublicMeeting);
meetingRouter.post('/by-code/:meetingCode/request-access', requestPrivateAccess);
meetingRouter.get('/by-code/:meetingCode/join-requests', listJoinRequests);
meetingRouter.post('/by-code/:meetingCode/join-requests/:requestId/decision', decideJoinRequest);
meetingRouter.post('/by-code/:meetingCode/reveal-problem', revealProblem);
meetingRouter.post('/by-code/:meetingCode/start-coding', startCoding);
