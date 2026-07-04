import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'x', httpOptions: { timeout: 120000 } });
console.log(ai.httpOptions);
