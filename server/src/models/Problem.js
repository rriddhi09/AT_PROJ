import mongoose from 'mongoose';

const problemSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  statement: { type: String, required: true, maxlength: 20000 },
  constraints: { type: String, default: '', maxlength: 5000 },
  inputFormat: { type: String, default: '', maxlength: 3000 },
  outputFormat: { type: String, default: '', maxlength: 3000 },
  allowedLanguages: { type: [String], default: ['javascript', 'python', 'cpp'] },
  timeLimitSec: { type: Number, required: true, min: 60, max: 14400 },
  order: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
problemSchema.index({ meetingId: 1, order: 1 });
export const Problem = mongoose.model('Problem', problemSchema);
