import mongoose from 'mongoose';

const meetingSchema = new mongoose.Schema({
  meetingCode: { type: String, required: true, unique: true, immutable: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: '', maxlength: 2000 },
  type: { type: String, enum: ['normal', 'technical_interview'], required: true },
  accessType: { type: String, enum: ['public', 'private'], default: 'private' },
  status: { type: String, enum: ['scheduled', 'live', 'ended'], default: 'scheduled', index: true },
  scheduledAt: Date, startedAt: Date, endedAt: Date,
  settings: {
    recordingEnabled: { type: Boolean, default: false }, chatEnabled: { type: Boolean, default: true },
    screenShareEnabled: { type: Boolean, default: true }, fileShareEnabled: { type: Boolean, default: true },
    maxParticipants: { type: Number, default: 10, min: 2, max: 100 }
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
