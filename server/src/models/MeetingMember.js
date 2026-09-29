import mongoose from 'mongoose';

const meetingMemberSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['host', 'interviewer', 'presenter', 'candidate', 'participant'], default: 'participant' },
  membershipStatus: { type: String, enum: ['invited', 'pending', 'approved', 'rejected', 'removed'], default: 'pending' },
  participantStatus: { type: String, enum: ['INVITED', 'WAITING', 'ADMITTED', 'JOINED', 'RECONNECTING', 'LEFT', 'REJECTED', 'REMOVED', 'BANNED'], default: 'INVITED' },
  canRejoin: { type: Boolean, default: true },
  rejectedUntil: { type: Date, default: null },
  permissions: {
    microphone: { type: Boolean, default: true }, camera: { type: Boolean, default: true },
    screenShare: { type: Boolean, default: false }, chat: { type: Boolean, default: true },
    reactions: { type: Boolean, default: true }, recording: { type: Boolean, default: false }, files: { type: Boolean, default: false },
    whiteboard: { type: [{ type: String, enum: ['VIEW', 'DRAW', 'EDIT', 'CLEAR', 'ADMIN'] }], default: ['VIEW'] }
  }
}, { timestamps: true });

meetingMemberSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
export const MeetingMember = mongoose.model('MeetingMember', meetingMemberSchema);
