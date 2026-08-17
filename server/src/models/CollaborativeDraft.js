import mongoose from 'mongoose';

const collaborativeDraftSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true, index: true },
  language: { type: String, enum: ['javascript', 'python', 'cpp'], required: true },
  sourceCode: { type: String, required: true, maxlength: 100000, default: '' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
collaborativeDraftSchema.index({ meetingId: 1, problemId: 1, language: 1 }, { unique: true });
export const CollaborativeDraft = mongoose.model('CollaborativeDraft', collaborativeDraftSchema);
