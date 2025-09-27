// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;

// শুধু JSON বডি পার্স
app.use(express.json());

// (ঐচ্ছিক) CORS: প্রয়োজন হলে আপনার ফ্রন্টএন্ড ডোমেইনগুলো এখানে রাখুন
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://smartprostuti.netlify.app',
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);               // curl/Postman
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'));
    },
  })
);

// Gemini init
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY missing');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// একটাই রুট: /api/ask
// ইনপুট: { text: "..." }  → আউটপুট: { answer: "..." }
app.post('/api/ask', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(text);
    const answer = result?.response?.text?.() || '';

    return res.json({ answer });
  } catch (err) {
    console.error('ask error:', err);
    res.status(500).json({ error: 'failed to generate answer' });
  }
});

// (ঐচ্ছিক) হেলথ-চেক
app.get('/', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
