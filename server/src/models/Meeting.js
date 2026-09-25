import mongoose from 'mongoose';

const meetingSchema = new mongoose.Schema({
  meetingCode: { type: String, required: true, unique: true, immutable: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  inviteVersion: { type: Number, default: 1, min: 1 },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: '', maxlength: 2000 },
  type: { type: String, enum: ['normal', 'technical_interview'], required: true },
  accessType: { type: String, enum: ['public', 'private'], default: 'private' },
  locked: { type: Boolean, default: false },
  status: { type: String, enum: ['SCHEDULED', 'WAITING_TO_START', 'LIVE', 'PAUSED', 'ENDED', 'CANCELLED', 'EXPIRED', 'scheduled', 'live', 'ended'], default: 'WAITING_TO_START', index: true },
  scheduledAt: Date, startedAt: Date, endedAt: Date, hostAbsentSince: Date,
  settings: {
    chatMode: { type: String, enum: ['CHAT_DISABLED', 'EVERYONE', 'HOST_ONLY', 'PRIVATE_MESSAGES_ALLOWED'], default: 'EVERYONE' },
    reactionsEnabled: { type: Boolean, default: true },
    fileShareEnabled: { type: Boolean, default: true },
    screenShareMode: { type: String, enum: ['HOST_ONLY', 'HOST_AND_COHOST', 'ALL_PARTICIPANTS'], default: 'HOST_AND_COHOST' },
    oneScreenShareAtATime: { type: Boolean, default: true },
    allowJoinBeforeHost: { type: Boolean, default: false },
    waitingRoomOpensMinutesBefore: { type: Number, default: 15, min: 0, max: 10080 },
    startAllowedMinutesBefore: { type: Number, default: 0, min: 0, max: 1440 },
    maxParticipants: { type: Number, default: 100, min: 2, max: 100 }
  },
  recording: {
    active: { type: Boolean, default: false }, startedAt: Date, stoppedAt: Date,
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    recordingUrl: { type: String, default: null }
  },
  technical: {
    problemVisible: { type: Boolean, default: false },
    durationSec: { type: Number, min: 60, max: 14400 },
    candidateStartedAt: Date
  },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

meetingSchema.index({ ownerId: 1, createdAt: -1 });
meetingSchema.index({ type: 1, status: 1 });
export const Meeting = mongoose.model('Meeting', meetingSchema);
