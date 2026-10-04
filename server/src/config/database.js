import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDatabase() {
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.info("MongoDB connected");
}
