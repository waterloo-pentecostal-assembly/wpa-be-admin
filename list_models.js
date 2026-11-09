import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "dummy");
async function list() {
  // list_models is not standard on standard genAI SDK, usually it's genAI.getGenerativeModel
  // Let me just curl the API
}
