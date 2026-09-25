import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Meeting } from '../models/Meeting.js';
import { MeetingMember } from '../models/MeetingMember.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { env } from '../config/env.js';
import { isTerminalMeetingStatus, refreshDueMeetingLifecycles, refreshMeetingLifecycle } from '../services/meetingLifecycleService.js';
import { signMeetingInvite, verifyMeetingInvite } from '../utils/tokens.js';

const createInput = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  type: z.enum(['normal', 'technical_interview']),
  accessType: z.enum(['public', 'private']).default('private'),
  scheduledAt: z.string().datetime().optional(),
  settings: z.object({ chatMode: z.enum(['CHAT_DISABLED', 'EVERYONE', 'HOST_ONLY', 'PRIVATE_MESSAGES_ALLOWED']).optional(), reactionsEnabled: z.boolean().optional(), fileShareEnabled: z.boolean().optional(), screenShareMode: z.enum(['HOST_ONLY', 'HOST_AND_COHOST', 'ALL_PARTICIPANTS']).optional(), oneScreenShareAtATime: z.boolean().optional(), allowJoinBeforeHost: z.boolean().optional(), waitingRoomOpensMinutesBefore: z.number().int().min(0).max(10080).optional(), startAllowedMinutesBefore: z.number().int().min(0).max(1440).optional(), maxParticipants: z.number().int().min(2).max(100).optional() }).optional()
});
const updateInput = z.object({ title: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).optional().default(''), accessType: z.enum(['public', 'private']), scheduledAt: z.string().datetime().nullable().optional(), allowJoinBeforeHost: z.boolean().optional(), waitingRoomOpensMinutesBefore: z.number().int().min(0).max(10080).optional(), startAllowedMinutesBefore: z.number().int().min(0).max(1440).optional(), maxParticipants: z.number().int().min(2).max(100).optional() });

function makeMeetingCode() { return crypto.randomBytes(9).toString('base64url'); }
function inviteTokenFrom(req) { return req.body?.inviteToken ?? req.query?.invite; }
function validateInvite(req, meeting) { const token = inviteTokenFrom(req); if (!token) throw new Error('A valid meeting invite is required.'); verifyMeetingInvite(token, meeting); }
function waitingRoomOpen(meeting) { if (!meeting.scheduledAt) return true; const minutes = meeting.settings?.waitingRoomOpensMinutesBefore ?? 15; return Date.now() >= new Date(meeting.scheduledAt).getTime() - minutes * 60000; }
function startWindowOpen(meeting) { if (!meeting.scheduledAt) return true; const minutes = meeting.settings?.startAllowedMinutesBefore ?? 0; return Date.now() >= new Date(meeting.scheduledAt).getTime() - minutes * 60000; }
function invalidOriginalSchedule(meeting) { return Boolean(meeting.scheduledAt && meeting.createdAt && new Date(meeting.scheduledAt).getTime() < new Date(meeting.createdAt).getTime()); }
const hostPermissions = { microphone: true, camera: true, screenShare: true, whiteboard: ['VIEW', 'DRAW', 'EDIT', 'CLEAR', 'ADMIN'], chat: true, reactions: true, recording: true, files: true, canChat: true, canShareScreen: true, canUploadFiles: true, canStartRecording: true, canManageParticipants: true };

export async function createMeeting(req, res, next) {
  try {
    const input = createInput.parse(req.body);
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) return res.status(400).json({ message: 'Scheduled date and time must be in the future.' });
    const meetingData = { meetingCode: makeMeetingCode(), ownerId: req.user._id, title: input.title, description: input.description, type: input.type, accessType: input.accessType, scheduledAt, status: scheduledAt && scheduledAt.getTime() > Date.now() ? 'SCHEDULED' : 'WAITING_TO_START', settings: input.settings, technical: input.type === 'technical_interview' ? { problemVisible: false } : undefined };
    let meeting;
    const createMembership = (meetingId, session) => MeetingMember.create([{ meetingId, userId: req.user._id, role: 'host', membershipStatus: 'approved', participantStatus: 'ADMITTED', canRejoin: true, permissions: hostPermissions, approvedBy: req.user._id, approvedAt: new Date() }], session ? { session } : undefined);
    if (env.mongoTransactions) {
      const session = await mongoose.startSession();
      try { await session.withTransaction(async () => { meeting = (await Meeting.create([meetingData], { session }))[0]; await createMembership(meeting._id, session); }); } finally { await session.endSession(); }
    } else {
      meeting = await Meeting.create(meetingData);
      try { await createMembership(meeting._id); } catch (error) { await Meeting.deleteOne({ _id: meeting._id }); throw error; }
    }
    const invite = signMeetingInvite(meeting);
    res.status(201).json({ meeting, joinPath: `/meetings/${meeting.meetingCode}?invite=${encodeURIComponent(invite)}` });
  } catch (error) { next(error); }
}

export async function listMyMeetings(req, res, next) {
  try {
    await refreshDueMeetingLifecycles();
    const meetings = await MeetingMember.aggregate([
      { $match: { userId: req.user._id, membershipStatus: 'approved' } },
      { $lookup: { from: 'meetings', localField: 'meetingId', foreignField: '_id', as: 'meeting' } },
      { $unwind: '$meeting' },
      { $match: { 'meeting.deletedAt': null } },
      { $project: { role: 1, membershipStatus: 1, permissions: 1, 'meeting._id': 1, 'meeting.meetingCode': 1, 'meeting.title': 1, 'meeting.type': 1, 'meeting.accessType': 1, 'meeting.status': 1, 'meeting.scheduledAt': 1, 'meeting.updatedAt': 1 } },
      { $sort: { 'meeting.updatedAt': -1 } }, { $limit: 50 }
    ]);
    res.json({ meetings });
  } catch (error) { next(error); }
}

export async function getMeetingByCode(req, res, next) {
  try {
    const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode, deletedAt: null });
    if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
    const member = await MeetingMember.findOne({ meetingId: meeting._id, userId: req.user._id }).lean();
    if (!member) { if (isTerminalMeetingStatus(meeting.status)) return res.status(403).json({ message: 'This meeting is no longer available.' }); try { validateInvite(req, meeting); } catch (error) { return res.status(403).json({ message: error.name === 'TokenExpiredError' ? 'This meeting invite has expired.' : error.message }); } }
    await refreshMeetingLifecycle(meeting);
    const sockets = req.app.get('io') ? await req.app.get('io').in(`meeting:${meeting._id}`).fetchSockets() : [];
    const hostPresent = sockets.some(socket => ['host', 'interviewer'].includes(socket.data.role));
    const invitePath = ['host', 'interviewer'].includes(member?.role) ? `/meetings/${meeting.meetingCode}?invite=${encodeURIComponent(signMeetingInvite(meeting))}` : null;
    res.json({ meeting: meeting.toObject(), hostPresent, invitePath, scheduleInvalid: invalidOriginalSchedule(meeting), waitingRoomOpen: !invalidOriginalSchedule(meeting) && waitingRoomOpen(meeting), membership: member ? { role: member.role, status: member.membershipStatus, participantStatus: member.participantStatus, canRejoin: member.canRejoin, rejectedUntil: member.rejectedUntil, permissions: member.permissions, isPrimaryHost: member.role === 'host' && meeting.ownerId.equals(req.user._id) } : null });
  } catch (error) { next(error); }
}

async function findMeetingAndMembership(meetingCode, userId) {
  const meeting = await Meeting.findOne({ meetingCode, deletedAt: null });
  if (!meeting) return { meeting: null, member: null };
  await refreshMeetingLifecycle(meeting);
  const member = await MeetingMember.findOne({ meetingId: meeting._id, userId });
  return { meeting, member };
}

const defaultParticipantPermissions = { microphone: true, camera: true, screenShare: false, whiteboard: ['VIEW'], chat: true, reactions: true, recording: false, files: false, canChat: true, canShareScreen: false, canUploadFiles: false, canStartRecording: false, canManageParticipants: false };

export async function joinPublicMeeting(req, res, next) {
  try {
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting || isTerminalMeetingStatus(meeting.status)) return res.status(403).json({ message: 'This meeting is no longer available.' });
    if (invalidOriginalSchedule(meeting)) return res.status(410).json({ message: 'This meeting was scheduled for a past date and cannot be joined. The host must correct the schedule.' });
    if (!member) { try { validateInvite(req, meeting); } catch (error) { return res.status(403).json({ message: error.name === 'TokenExpiredError' ? 'This meeting invite has expired.' : error.message }); } }
    if (!waitingRoomOpen(meeting)) return res.status(403).json({ message: `The waiting room opens ${meeting.settings?.waitingRoomOpensMinutesBefore ?? 15} minutes before the scheduled time.` });
    if (meeting.locked && !['host', 'interviewer'].includes(member?.role)) return res.status(423).json({ message: 'The host has locked this meeting.' });
    if (meeting.accessType !== 'public') return res.status(403).json({ message: 'This private meeting requires host approval.' });
    if (member?.participantStatus === 'BANNED') return res.status(403).json({ message: 'You are blocked from this meeting.' });
    if (member?.participantStatus === 'REMOVED' || member?.canRejoin === false) return res.status(403).json({ message: 'You have been removed from this meeting.' });
    const updated = await MeetingMember.findOneAndUpdate(
      { meetingId: meeting._id, userId: req.user._id },
      { $set: { membershipStatus: 'approved', participantStatus: 'ADMITTED', canRejoin: true, rejectedUntil: null, updatedAt: new Date() }, $setOnInsert: { meetingId: meeting._id, userId: req.user._id, role: 'participant', permissions: defaultParticipantPermissions } },
      { new: true, upsert: true }
    );
    res.json({ membership: { role: updated.role, status: updated.membershipStatus, permissions: updated.permissions } });
  } catch (error) { next(error); }
}

export async function requestPrivateAccess(req, res, next) {
  try {
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting || isTerminalMeetingStatus(meeting.status)) return res.status(403).json({ message: 'This meeting is no longer available.' });
    if (invalidOriginalSchedule(meeting)) return res.status(410).json({ message: 'This meeting was scheduled for a past date and cannot be joined. The host must correct the schedule.' });
    if (!member) { try { validateInvite(req, meeting); } catch (error) { return res.status(403).json({ message: error.name === 'TokenExpiredError' ? 'This meeting invite has expired.' : error.message }); } }
    if (!waitingRoomOpen(meeting)) return res.status(403).json({ message: `The waiting room opens ${meeting.settings?.waitingRoomOpensMinutesBefore ?? 15} minutes before the scheduled time.` });
    if (meeting.locked) return res.status(423).json({ message: 'The host has locked this meeting.' });
    if (meeting.accessType !== 'private') return res.status(400).json({ message: 'This meeting is public; join it directly.' });
    if (member?.membershipStatus === 'approved') return res.json({ status: 'approved', message: 'You are already approved.' });
    if (member?.participantStatus === 'BANNED') return res.status(403).json({ message: 'The host blocked you from this meeting.' });
    if (member?.participantStatus === 'REMOVED' || member?.canRejoin === false) return res.status(403).json({ message: 'You were removed and cannot rejoin this meeting.' });
    if (member?.participantStatus === 'REJECTED' && member.rejectedUntil?.getTime() > Date.now()) {
      const retryAfterSec = Math.ceil((member.rejectedUntil.getTime() - Date.now()) / 1000);
      return res.status(429).json({ message: `Request rejected. You may request again in ${retryAfterSec} seconds.`, retryAfterSec, rejectedUntil: member.rejectedUntil });
    }
    const request = await JoinRequest.findOneAndUpdate({ meetingId: meeting._id, userId: req.user._id }, { $set: { status: 'pending', decidedBy: null, decidedAt: null }, $setOnInsert: { meetingId: meeting._id, userId: req.user._id } }, { new: true, upsert: true });
    await MeetingMember.findOneAndUpdate({ meetingId: meeting._id, userId: req.user._id }, { $set: { membershipStatus: 'pending', participantStatus: 'WAITING', canRejoin: true, rejectedUntil: null }, $setOnInsert: { meetingId: meeting._id, userId: req.user._id, role: 'participant', permissions: defaultParticipantPermissions } }, { upsert: true });
    res.status(202).json({ status: request.status, message: 'Access request sent to the host.' });
  } catch (error) { next(error); }
}

function canManage(member) { return member?.role === 'host' || member?.permissions?.canManageParticipants; }
export async function listJoinRequests(req, res, next) {
  try {
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
    if (!canManage(member)) return res.status(403).json({ message: 'Host permission required.' });
    const requests = await JoinRequest.find({ meetingId: meeting._id, status: 'pending' }).sort({ createdAt: 1 }).populate('userId', 'name email avatarUrl').lean();
    res.json({ requests: requests.map((request) => ({ id: request._id, user: request.userId, createdAt: request.createdAt })) });
  } catch (error) { next(error); }
}

export async function decideJoinRequest(req, res, next) {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected', 'blocked']) }).parse(req.body);
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
    if (isTerminalMeetingStatus(meeting.status)) return res.status(409).json({ message: 'Participants cannot be admitted to a closed meeting.' });
    if (!canManage(member)) return res.status(403).json({ message: 'Host permission required.' });
    const request = await JoinRequest.findOne({ _id: req.params.requestId, meetingId: meeting._id, status: 'pending' });
    if (!request) return res.status(404).json({ message: 'Pending request not found.' });
    request.status = input.decision; request.decidedBy = req.user._id; request.decidedAt = new Date(); await request.save();
    const now = new Date(); const approved = input.decision === 'approved'; const blocked = input.decision === 'blocked';
    await MeetingMember.updateOne({ meetingId: meeting._id, userId: request.userId }, { $set: { membershipStatus: approved ? 'approved' : (blocked ? 'removed' : 'rejected'), participantStatus: approved ? 'ADMITTED' : (blocked ? 'BANNED' : 'REJECTED'), canRejoin: !blocked, rejectedUntil: input.decision === 'rejected' ? new Date(Date.now() + 30000) : null, bannedAt: blocked ? now : null, approvedBy: approved ? req.user._id : null, approvedAt: approved ? now : null } });
    res.json({ status: input.decision });
  } catch (error) { next(error); }
}

export async function updateMeeting(req, res, next) { try { const input = updateInput.parse(req.body); const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Host permission required.' }); if (isTerminalMeetingStatus(meeting.status) || ['LIVE', 'PAUSED'].includes(meeting.status)) return res.status(409).json({ message: 'Meeting details cannot be changed after it has started or closed.' }); const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null; if (scheduledAt && scheduledAt.getTime() <= Date.now()) return res.status(400).json({ message: 'Scheduled date and time must be in the future.' }); meeting.title = input.title; meeting.description = input.description; meeting.accessType = input.accessType; meeting.scheduledAt = scheduledAt; for (const key of ['allowJoinBeforeHost', 'waitingRoomOpensMinutesBefore', 'startAllowedMinutesBefore', 'maxParticipants']) if (input[key] !== undefined) meeting.settings[key] = input[key]; meeting.status = meeting.scheduledAt ? 'SCHEDULED' : 'WAITING_TO_START'; await meeting.save(); res.json({ meeting }); } catch (error) { next(error); } }

export async function startMeeting(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Only the host can start this meeting.' }); if (invalidOriginalSchedule(meeting)) return res.status(410).json({ message: 'This meeting was scheduled for a past date. Correct the schedule before starting it.' }); if (!startWindowOpen(meeting)) return res.status(409).json({ message: `This meeting can be started ${meeting.settings?.startAllowedMinutesBefore ?? 0} minutes before its scheduled time.` }); if (!['SCHEDULED', 'WAITING_TO_START'].includes(meeting.status)) return res.status(409).json({ message: `Meeting cannot be started while it is ${meeting.status}.` }); meeting.status = 'LIVE'; meeting.startedAt = new Date(); await meeting.save(); req.app.get('io')?.to(`meeting:${meeting._id}`).emit('meeting:status', { status: 'LIVE' }); res.json({ meeting }); } catch (error) { next(error); } }

export async function pauseMeeting(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Only the host can pause this meeting.' }); if (meeting.status !== 'LIVE') return res.status(409).json({ message: 'Only a live meeting can be paused.' }); meeting.status = 'PAUSED'; await meeting.save(); req.app.get('io')?.to(`meeting:${meeting._id}`).emit('meeting:status', { status: 'PAUSED' }); res.json({ meeting }); } catch (error) { next(error); } }

export async function resumeMeeting(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Only the host can resume this meeting.' }); if (meeting.status !== 'PAUSED') return res.status(409).json({ message: 'Only a paused meeting can be resumed.' }); meeting.status = 'LIVE'; await meeting.save(); req.app.get('io')?.to(`meeting:${meeting._id}`).emit('meeting:status', { status: 'LIVE' }); res.json({ meeting }); } catch (error) { next(error); } }

export async function closeMeeting(req, res, next) { try { const input = z.object({ action: z.enum(['end', 'cancel']) }).parse(req.body); const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (!['host', 'interviewer'].includes(member?.role)) return res.status(403).json({ message: 'Only the host or co-host can close this meeting.' }); if (isTerminalMeetingStatus(meeting.status)) return res.status(409).json({ message: 'This meeting is already closed.' }); if (input.action === 'cancel' && ['LIVE', 'PAUSED'].includes(meeting.status)) return res.status(409).json({ message: 'A started meeting must be ended, not cancelled.' }); meeting.status = input.action === 'cancel' ? 'CANCELLED' : 'ENDED'; meeting.endedAt = new Date(); if (meeting.recording?.active) { meeting.recording.active = false; meeting.recording.stoppedAt = new Date(); } await meeting.save(); await MeetingMember.updateMany({ meetingId: meeting._id, participantStatus: { $in: ['JOINED', 'RECONNECTING'] } }, { $set: { participantStatus: 'LEFT', reconnectingAt: null, leftAt: new Date() } }); const io = req.app.get('io'); const room = `meeting:${meeting._id}`; io?.to(room).emit('meeting:closed', { status: meeting.status, message: input.action === 'cancel' ? 'The host cancelled this meeting.' : 'The host ended this meeting.' }); const sockets = io ? await io.in(room).fetchSockets() : []; sockets.forEach(socket => socket.disconnect(true)); res.json({ meeting }); } catch (error) { next(error); } }

export async function updateLiveControls(req, res, next) { try { const input = z.object({ locked: z.boolean().optional(), chatMode: z.enum(['CHAT_DISABLED', 'EVERYONE', 'HOST_ONLY', 'PRIVATE_MESSAGES_ALLOWED']).optional(), reactionsEnabled: z.boolean().optional() }).refine(value => Object.keys(value).length > 0).parse(req.body); const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (member?.role !== 'host') return res.status(403).json({ message: 'Only the host can change live meeting controls.' }); if (!['LIVE', 'PAUSED'].includes(meeting.status)) return res.status(409).json({ message: 'Live controls are available only during an active meeting.' }); if (input.locked !== undefined) meeting.locked = input.locked; if (input.chatMode !== undefined) meeting.settings.chatMode = input.chatMode; if (input.reactionsEnabled !== undefined) meeting.settings.reactionsEnabled = input.reactionsEnabled; await meeting.save(); const controls = { locked: meeting.locked, chatMode: meeting.settings.chatMode, reactionsEnabled: meeting.settings.reactionsEnabled }; const io = req.app.get('io'); const room = `meeting:${meeting._id}`; const sockets = io ? await io.in(room).fetchSockets() : []; sockets.forEach(socket => { socket.data.meetingSettings = { ...socket.data.meetingSettings, chatMode: controls.chatMode, reactionsEnabled: controls.reactionsEnabled }; socket.emit('meeting:controls', controls); }); res.json({ controls }); } catch (error) { next(error); } }

export async function startRecording(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting || meeting.status !== 'LIVE') return res.status(409).json({ message: 'Recording is available only during a live meeting.' }); if (member?.role !== 'host') return res.status(403).json({ message: 'Only the host can start recording.' }); if (meeting.recording?.active) return res.status(409).json({ message: 'Recording is already active.' }); meeting.recording.active = true; meeting.recording.startedAt = new Date(); meeting.recording.stoppedAt = null; meeting.recording.startedBy = req.user._id; meeting.recording.recordingUrl = null; await meeting.save(); const recording = meeting.recording.toObject?.() ?? meeting.recording; req.app.get('io')?.to(`meeting:${meeting._id}`).emit('recording:status', { active: true, startedAt: recording.startedAt, startedBy: { id: req.user._id, name: req.user.name } }); res.json({ recording }); } catch (error) { next(error); } }

export async function stopRecording(req, res, next) { try { const input = z.object({ recordingUrl: z.string().trim().max(2000).nullable().optional() }).parse(req.body); const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (member?.role !== 'host') return res.status(403).json({ message: 'Only the host can stop recording.' }); if (!meeting.recording?.active) return res.status(409).json({ message: 'Recording is not active.' }); meeting.recording.active = false; meeting.recording.stoppedAt = new Date(); meeting.recording.recordingUrl = input.recordingUrl ?? 'local-device-download'; await meeting.save(); const recording = meeting.recording.toObject?.() ?? meeting.recording; req.app.get('io')?.to(`meeting:${meeting._id}`).emit('recording:status', { active: false, stoppedAt: recording.stoppedAt }); res.json({ recording }); } catch (error) { next(error); } }

export async function rotateMeetingInvite(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (member?.role !== 'host' || !meeting.ownerId.equals(req.user._id)) return res.status(403).json({ message: 'Only the primary host can regenerate the invite link.' }); if (isTerminalMeetingStatus(meeting.status)) return res.status(409).json({ message: 'A closed meeting cannot receive a new invite link.' }); meeting.inviteVersion = (meeting.inviteVersion ?? 1) + 1; await meeting.save(); const joinPath = `/meetings/${meeting.meetingCode}?invite=${encodeURIComponent(signMeetingInvite(meeting))}`; res.json({ joinPath, inviteVersion: meeting.inviteVersion }); } catch (error) { next(error); } }

export async function revealProblem(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting || meeting.type !== 'technical_interview') return res.status(404).json({ message: 'Technical interview not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Interviewer permission required.' }); if (!['LIVE', 'PAUSED'].includes(meeting.status)) return res.status(409).json({ message: 'The problem can be revealed only during an active interview.' }); meeting.technical.problemVisible = true; await meeting.save(); req.app.get('io')?.to(`meeting:${meeting._id}`).emit('problem:revealed', { meetingCode: meeting.meetingCode }); res.json({ technical: meeting.technical }); } catch (error) { next(error); } }
export async function startCoding(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting || meeting.type !== 'technical_interview') return res.status(404).json({ message: 'Technical interview not found.' }); if (!member || member.role === 'host' || member.role === 'interviewer') return res.status(403).json({ message: 'Only the candidate can start coding.' }); if (!['LIVE', 'PAUSED'].includes(meeting.status)) return res.status(409).json({ message: 'Coding can start only during an active interview.' }); if (!meeting.technical?.problemVisible) return res.status(403).json({ message: 'The interviewer has not revealed the problem yet.' }); if (!meeting.technical.candidateStartedAt) { meeting.technical.candidateStartedAt = new Date(); await meeting.save(); req.app.get('io')?.to(`meeting:${meeting._id}`).emit('coding:started', { startedAt: meeting.technical.candidateStartedAt, durationSec: meeting.technical.durationSec }); } res.json({ startedAt: meeting.technical.candidateStartedAt, durationSec: meeting.technical.durationSec }); } catch (error) { next(error); } }
