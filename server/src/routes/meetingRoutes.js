import { Router } from 'express';
import { createMeeting, decideJoinRequest, getMeetingByCode, joinPublicMeeting, listJoinRequests, listMyMeetings, requestPrivateAccess } from '../controllers/meetingController.js';
import { authenticate } from '../middleware/authenticate.js';

export const meetingRouter = Router();
meetingRouter.use(authenticate);
meetingRouter.route('/').post(createMeeting).get(listMyMeetings);
meetingRouter.get('/by-code/:meetingCode', getMeetingByCode);
meetingRouter.post('/by-code/:meetingCode/join', joinPublicMeeting);
meetingRouter.post('/by-code/:meetingCode/request-access', requestPrivateAccess);
meetingRouter.get('/by-code/:meetingCode/join-requests', listJoinRequests);
meetingRouter.post('/by-code/:meetingCode/join-requests/:requestId/decision', decideJoinRequest);
