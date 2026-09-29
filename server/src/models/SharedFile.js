import mongoose from 'mongoose';

const sharedFileSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  originalName: { type: String, required: true, maxlength: 180 },
  storedName: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true, maxlength: 120 },
  size: { type: Number, required: true, max: 8 * 1024 * 1024 }
}, { timestamps: true });
export const SharedFile = mongoose.model('SharedFile', sharedFileSchema);
