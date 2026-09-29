import mongoose from 'mongoose';

const candidateDraftSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true, index: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  language: { type: String, enum: ['javascript', 'python', 'cpp'], required: true },
  sourceCode: { type: String, required: true, maxlength: 100000, default: '' }
}, { timestamps: true });

candidateDraftSchema.index({ meetingId: 1, problemId: 1, candidateId: 1, language: 1 }, { unique: true });

export const CandidateDraft = mongoose.model('CandidateDraft', candidateDraftSchema);
