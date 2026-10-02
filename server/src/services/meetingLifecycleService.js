import { Meeting } from '../models/Meeting.js';
import { MeetingMember } from '../models/MeetingMember.js';
import { env } from '../config/env.js';

const legacy = { scheduled: 'SCHEDULED', live: 'LIVE', ended: 'ENDED' };
const expiryMs = 30 * 24 * 60 * 60 * 1000;

export async function refreshMeetingLifecycle(meeting) {
  if (!meeting || meeting.deletedAt) return meeting;
  const now = Date.now();
  let status = legacy[meeting.status] ?? meeting.status;
  const reference = meeting.scheduledAt ?? meeting.createdAt;
  if (['SCHEDULED', 'WAITING_TO_START'].includes(status) && reference && now - new Date(reference).getTime() > expiryMs) status = 'EXPIRED';
  else if (status === 'SCHEDULED' && (!meeting.scheduledAt || new Date(meeting.scheduledAt).getTime() <= now)) status = 'WAITING_TO_START';
  else if (['LIVE', 'PAUSED'].includes(status) && meeting.hostAbsentSince && now - new Date(meeting.hostAbsentSince).getTime() >= env.hostAbsenceGraceSeconds * 1000) { status = 'ENDED'; meeting.endedAt = new Date(); }
  if (status !== meeting.status) { meeting.status = status; await meeting.save(); if (status === 'ENDED') await MeetingMember.updateMany({ meetingId: meeting._id, participantStatus: { $in: ['JOINED', 'RECONNECTING'] } }, { $set: { participantStatus: 'LEFT' } }); }
  return meeting;
}

export async function refreshDueMeetingLifecycles() {
  const candidates = await Meeting.find({ deletedAt: null, status: { $in: ['SCHEDULED', 'WAITING_TO_START', 'scheduled', 'LIVE', 'PAUSED'] } });
  await Promise.all(candidates.map(refreshMeetingLifecycle));
}

export async function expireCodingRounds(io) {
  const active = await Meeting.find({ deletedAt: null, type: 'technical_interview', status: { $in: ['LIVE', 'PAUSED'] }, 'technical.candidateStartedAt': { $ne: null }, 'technical.roundEndedAt': null }).select('technical');
  const now = Date.now();
  await Promise.all(active.filter(meeting => now >= new Date(meeting.technical.candidateStartedAt).getTime() + (meeting.technical.durationSec ?? 0) * 1000).map(async meeting => {
    const endedAt = new Date();
    const ended = await Meeting.findOneAndUpdate({ _id: meeting._id, 'technical.roundEndedAt': null }, { $set: { 'technical.roundEndedAt': endedAt, 'technical.codingAccess': false } });
    if (ended) io?.to(`meeting:${meeting._id}`).emit('coding:ended', { candidateId: String(meeting.technical.candidateId), reason: 'time_expired', endedAt });
  }));
}

export async function beginStartupHostRecoveryWindow() { await Meeting.updateMany({ deletedAt: null, status: { $in: ['LIVE', 'PAUSED'] }, hostAbsentSince: null }, { $set: { hostAbsentSince: new Date() } }); }

export function isTerminalMeetingStatus(status) { return ['ENDED', 'CANCELLED', 'EXPIRED', 'ended'].includes(status); }
