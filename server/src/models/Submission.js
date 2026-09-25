import mongoose from 'mongoose';

const submissionSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true, index: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  language: { type: String, required: true }, sourceCode: { type: String, required: true, maxlength: 100000 },
  action: { type: String, enum: ['run', 'submit'], required: true }, status: { type: String, enum: ['completed', 'failed'], required: true },
  testSummary: { passed: Number, total: Number }, visibleResult: { stdout: String, stderr: String, compileError: String, runtimeMs: Number }
}, { timestamps: true });
submissionSchema.index({ meetingId: 1, candidateId: 1, createdAt: -1 });
export const Submission = mongoose.model('Submission', submissionSchema);
