import mongoose from 'mongoose';

const meetingMemberSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['host', 'interviewer', 'candidate', 'participant'], default: 'participant' },
  membershipStatus: { type: String, enum: ['invited', 'pending', 'approved', 'rejected', 'removed'], default: 'pending' },
  permissions: { canChat: { type: Boolean, default: true }, canShareScreen: { type: Boolean, default: true }, canUploadFiles: { type: Boolean, default: false }, canStartRecording: { type: Boolean, default: false }, canManageParticipants: { type: Boolean, default: false } },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date, joinedAt: Date, removedAt: Date
}, { timestamps: true });

meetingMemberSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
meetingMemberSchema.index({ userId: 1, updatedAt: -1 });
export const MeetingMember = mongoose.model('MeetingMember', meetingMemberSchema);
