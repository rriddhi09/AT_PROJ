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
  if (status !== meeting.status) { meeting.status = status; await meeting.save(); if (status === 'ENDED') await MeetingMember.updateMany({ meetingId: meeting._id, participantStatus: { $in: ['JOINED', 'RECONNECTING'] } }, { $set: { participantStatus: 'LEFT', reconnectingAt: null, leftAt: new Date() } }); }
  return meeting;
}

export async function refreshDueMeetingLifecycles() {
  const candidates = await Meeting.find({ deletedAt: null, status: { $in: ['SCHEDULED', 'WAITING_TO_START', 'scheduled', 'LIVE', 'PAUSED'] } });
  await Promise.all(candidates.map(refreshMeetingLifecycle));
}

export async function beginStartupHostRecoveryWindow() { await Meeting.updateMany({ deletedAt: null, status: { $in: ['LIVE', 'PAUSED'] }, hostAbsentSince: null }, { $set: { hostAbsentSince: new Date() } }); }

export function isTerminalMeetingStatus(status) { return ['ENDED', 'CANCELLED', 'EXPIRED', 'ended'].includes(status); }
