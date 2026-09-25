import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

chatMessageSchema.index({ meetingId: 1, createdAt: -1 });
chatMessageSchema.index({ meetingId: 1, recipientId: 1, createdAt: -1 });

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
