import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Meeting } from '../models/Meeting.js';
import { MeetingMember } from '../models/MeetingMember.js';
import { JoinRequest } from '../models/JoinRequest.js';
import { env } from '../config/env.js';

const createInput = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().default(''),
  type: z.enum(['normal', 'technical_interview']),
  accessType: z.enum(['public', 'private']).default('private'),
  scheduledAt: z.string().datetime().optional(),
  settings: z.object({ recordingEnabled: z.boolean().optional(), chatEnabled: z.boolean().optional(), screenShareEnabled: z.boolean().optional(), fileShareEnabled: z.boolean().optional(), maxParticipants: z.number().int().min(2).max(100).optional() }).optional()
});
const updateInput = z.object({ title: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).optional().default(''), accessType: z.enum(['public', 'private']), scheduledAt: z.string().datetime().nullable().optional() });

function makeMeetingCode() { return crypto.randomBytes(9).toString('base64url'); }
const hostPermissions = { canChat: true, canShareScreen: true, canUploadFiles: true, canStartRecording: true, canManageParticipants: true };

export async function createMeeting(req, res, next) {
  try {
    const input = createInput.parse(req.body);
    const meetingData = { meetingCode: makeMeetingCode(), ownerId: req.user._id, title: input.title, description: input.description, type: input.type, accessType: input.accessType, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined, settings: input.settings, technical: input.type === 'technical_interview' ? { problemVisible: false } : undefined };
    let meeting;
    const createMembership = (meetingId, session) => MeetingMember.create([{ meetingId, userId: req.user._id, role: 'host', membershipStatus: 'approved', permissions: hostPermissions, approvedBy: req.user._id, approvedAt: new Date() }], session ? { session } : undefined);
    if (env.mongoTransactions) {
      const session = await mongoose.startSession();
      try { await session.withTransaction(async () => { meeting = (await Meeting.create([meetingData], { session }))[0]; await createMembership(meeting._id, session); }); } finally { await session.endSession(); }
    } else {
      meeting = await Meeting.create(meetingData);
      try { await createMembership(meeting._id); } catch (error) { await Meeting.deleteOne({ _id: meeting._id }); throw error; }
    }
    res.status(201).json({ meeting, joinPath: `/meetings/${meeting.meetingCode}` });
  } catch (error) { next(error); }
}

export async function listMyMeetings(req, res, next) {
  try {
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
    const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode, deletedAt: null }).lean();
    if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
    const member = await MeetingMember.findOne({ meetingId: meeting._id, userId: req.user._id }).lean();
    res.json({ meeting, membership: member ? { role: member.role, status: member.membershipStatus, permissions: member.permissions } : null });
  } catch (error) { next(error); }
}

async function findMeetingAndMembership(meetingCode, userId) {
  const meeting = await Meeting.findOne({ meetingCode, deletedAt: null });
  if (!meeting) return { meeting: null, member: null };
  const member = await MeetingMember.findOne({ meetingId: meeting._id, userId });
  return { meeting, member };
}

const defaultParticipantPermissions = { canChat: true, canShareScreen: true, canUploadFiles: false, canStartRecording: false, canManageParticipants: false };

export async function joinPublicMeeting(req, res, next) {
  try {
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting || meeting.status === 'ended') return res.status(404).json({ message: 'Meeting is unavailable.' });
    if (meeting.accessType !== 'public') return res.status(403).json({ message: 'This private meeting requires host approval.' });
    if (member?.membershipStatus === 'removed') return res.status(403).json({ message: 'You have been removed from this meeting.' });
    const updated = await MeetingMember.findOneAndUpdate(
      { meetingId: meeting._id, userId: req.user._id },
      { $set: { membershipStatus: 'approved', updatedAt: new Date() }, $setOnInsert: { meetingId: meeting._id, userId: req.user._id, role: 'participant', permissions: defaultParticipantPermissions } },
      { new: true, upsert: true }
    );
    res.json({ membership: { role: updated.role, status: updated.membershipStatus, permissions: updated.permissions } });
  } catch (error) { next(error); }
}

export async function requestPrivateAccess(req, res, next) {
  try {
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting || meeting.status === 'ended') return res.status(404).json({ message: 'Meeting is unavailable.' });
    if (meeting.accessType !== 'private') return res.status(400).json({ message: 'This meeting is public; join it directly.' });
    if (member?.membershipStatus === 'approved') return res.json({ status: 'approved', message: 'You are already approved.' });
    if (member?.membershipStatus === 'removed') return res.status(403).json({ message: 'You have been removed from this meeting.' });
    const request = await JoinRequest.findOneAndUpdate({ meetingId: meeting._id, userId: req.user._id }, { $setOnInsert: { meetingId: meeting._id, userId: req.user._id, status: 'pending' } }, { new: true, upsert: true });
    await MeetingMember.findOneAndUpdate({ meetingId: meeting._id, userId: req.user._id }, { $set: { membershipStatus: 'pending' }, $setOnInsert: { meetingId: meeting._id, userId: req.user._id, role: 'participant', permissions: defaultParticipantPermissions } }, { upsert: true });
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
    const input = z.object({ decision: z.enum(['approved', 'rejected']) }).parse(req.body);
    const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
    if (!canManage(member)) return res.status(403).json({ message: 'Host permission required.' });
    const request = await JoinRequest.findOne({ _id: req.params.requestId, meetingId: meeting._id, status: 'pending' });
    if (!request) return res.status(404).json({ message: 'Pending request not found.' });
    request.status = input.decision; request.decidedBy = req.user._id; request.decidedAt = new Date(); await request.save();
    await MeetingMember.updateOne({ meetingId: meeting._id, userId: request.userId }, { $set: { membershipStatus: input.decision, approvedBy: input.decision === 'approved' ? req.user._id : null, approvedAt: input.decision === 'approved' ? new Date() : null } });
    res.json({ status: input.decision });
  } catch (error) { next(error); }
}

export async function updateMeeting(req, res, next) { try { const input = updateInput.parse(req.body); const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting) return res.status(404).json({ message: 'Meeting not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Host permission required.' }); meeting.title = input.title; meeting.description = input.description; meeting.accessType = input.accessType; meeting.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null; await meeting.save(); res.json({ meeting }); } catch (error) { next(error); } }

export async function revealProblem(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting || meeting.type !== 'technical_interview') return res.status(404).json({ message: 'Technical interview not found.' }); if (!canManage(member)) return res.status(403).json({ message: 'Interviewer permission required.' }); meeting.technical.problemVisible = true; await meeting.save(); res.json({ technical: meeting.technical }); } catch (error) { next(error); } }
export async function startCoding(req, res, next) { try { const { meeting, member } = await findMeetingAndMembership(req.params.meetingCode, req.user._id); if (!meeting || meeting.type !== 'technical_interview') return res.status(404).json({ message: 'Technical interview not found.' }); if (!member || member.role === 'host' || member.role === 'interviewer') return res.status(403).json({ message: 'Only the candidate can start coding.' }); if (!meeting.technical?.problemVisible) return res.status(403).json({ message: 'The interviewer has not revealed the problem yet.' }); if (!meeting.technical.candidateStartedAt) { meeting.technical.candidateStartedAt = new Date(); await meeting.save(); } res.json({ startedAt: meeting.technical.candidateStartedAt, durationSec: meeting.technical.durationSec }); } catch (error) { next(error); } }
