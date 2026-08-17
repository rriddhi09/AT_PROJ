import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Meeting } from '../models/Meeting.js';
import { MeetingMember } from '../models/MeetingMember.js';
import { SharedFile } from '../models/SharedFile.js';

const uploadInput = z.object({ name: z.string().trim().min(1).max(180), mimeType: z.string().trim().min(1).max(120), contentBase64: z.string().min(1) });
const uploadsDir = path.resolve(process.cwd(), 'uploads');
async function access(meetingCode, userId) { const meeting = await Meeting.findOne({ meetingCode, deletedAt: null }).lean(); if (!meeting) return null; return await MeetingMember.exists({ meetingId: meeting._id, userId, membershipStatus: 'approved' }) ? meeting : null; }
export async function listFiles(req, res, next) { try { const meeting = await access(req.params.meetingCode, req.user._id); if (!meeting) return res.status(403).json({ message: 'Meeting approval is required.' }); const files = await SharedFile.find({ meetingId: meeting._id }).populate('uploadedBy', 'name').sort({ createdAt: -1 }).lean(); res.json({ files: files.map(file => ({ id: file._id, name: file.originalName, mimeType: file.mimeType, size: file.size, uploadedBy: file.uploadedBy?.name ?? 'Participant', createdAt: file.createdAt, url: `/uploads/${file.storedName}` })) }); } catch (error) { next(error); } }
export async function uploadFile(req, res, next) { try { const input = uploadInput.parse(req.body); const meeting = await access(req.params.meetingCode, req.user._id); if (!meeting) return res.status(403).json({ message: 'Meeting approval is required.' }); const bytes = Buffer.from(input.contentBase64, 'base64'); if (!bytes.length || bytes.length > 8 * 1024 * 1024) return res.status(400).json({ message: 'Files must be between 1 byte and 8 MB.' }); const storedName = `${crypto.randomUUID()}${path.extname(input.name).slice(0, 12).toLowerCase()}`; await fs.mkdir(uploadsDir, { recursive: true }); await fs.writeFile(path.join(uploadsDir, storedName), bytes, { flag: 'wx' }); const file = await SharedFile.create({ meetingId: meeting._id, uploadedBy: req.user._id, originalName: path.basename(input.name), storedName, mimeType: input.mimeType, size: bytes.length }); res.status(201).json({ file: { id: file._id, name: file.originalName, mimeType: file.mimeType, size: file.size, url: `/uploads/${file.storedName}` } }); } catch (error) { next(error); } }
