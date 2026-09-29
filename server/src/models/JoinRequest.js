import mongoose from 'mongoose';

const joinRequestSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'blocked'], default: 'pending' }
}, { timestamps: true });

joinRequestSchema.index({ meetingId: 1, userId: 1 }, { unique: true });
export const JoinRequest = mongoose.model('JoinRequest', joinRequestSchema);
