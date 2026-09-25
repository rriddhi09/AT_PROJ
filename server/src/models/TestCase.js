 import mongoose from 'mongoose';

const testCaseSchema = new mongoose.Schema({
  problemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Problem', required: true },
  input: { type: String, required: true, maxlength: 50000 },
  expectedOutput: { type: String, required: true, maxlength: 50000 },
  isHidden: { type: Boolean, default: false },
  order: { type: Number, default: 0 }
}, { timestamps: true });
testCaseSchema.index({ problemId: 1, isHidden: 1, order: 1 });
export const TestCase = mongoose.model('TestCase', testCaseSchema);
