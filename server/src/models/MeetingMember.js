import mongoose from 'mongoose';

const meetingMemberSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['host', 'interviewer', 'presenter', 'candidate', 'participant'], default: 'participant' },
  handRaisedAt: { type: Date, default: null },
  membershipStatus: { type: String, enum: ['invited', 'pending', 'approved', 'rejected', 'removed'], default: 'pending' },
  participantStatus: { type: String, enum: ['INVITED', 'WAITING', 'ADMITTED', 'JOINED', 'RECONNECTING', 'LEFT', 'REJECTED', 'REMOVED', 'BANNED'], default: 'INVITED', index: true },
  canRejoin: { type: Boolean, default: true },
  rejectedUntil: { type: Date, default: null },
  permissions: {
    microphone: { type: Boolean, default: true }, camera: { type: Boolean, default: true },
    screenShare: { type: Boolean, default: false }, chat: { type: Boolean, default: true },
    reactions: { type: Boolean, default: true }, recording: { type: Boolean, default: false }, files: { type: Boolean, default: false },
    whiteboard: { type: [{ type: String, enum: ['VIEW', 'DRAW', 'EDIT', 'CLEAR', 'ADMIN'] }], default: ['VIEW'] },
    canChat: { type: Boolean, default: true }, canShareScreen: { type: Boolean, default: false },
    canUploadFiles: { type: Boolean, default: false }, canStartRecording: { type: Boolean, default: false },
    canManageParticipants: { type: Boolean, default: false }
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date, joinedAt: Date, reconnectingAt: Date, leftAt: Date, removedAt: Date, bannedAt: Date
}, { timestamps: true });

meetingMemberSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
meetingMemberSchema.index({ userId: 1, updatedAt: -1 });
export const MeetingMember = mongoose.model('MeetingMember', meetingMemberSchema);
