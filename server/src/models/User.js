import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  avatarUrl: { type: String, default: null },
  accountStatus: { type: String, enum: ['active', 'suspended'], default: 'active' },
  lastLoginAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
userSchema.set('toJSON', { transform: (_, returned) => { delete returned.passwordHash; return returned; } });

export const User = mongoose.model('User', userSchema);
