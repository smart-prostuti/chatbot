// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// ---------------- CORS ----------------
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://smartprostuti.netlify.app',
  'https://smartprostuti.com',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/Postman/no-origin
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked'));
  },
}));

// -------------- Gemini init --------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY missing');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ---------- Config & helpers ----------

// System prompt: Bangla, structured, factual
const SYSTEM_PROMPT = `
তুমি একজন সহায়ক সহকারী। সবসময় স্পষ্ট, প্রাকৃতিক বাংলায় উত্তর দেবে।
নীতিমালা:
- অনুমানভিত্তিক তথ্য পরিহার করো; নিশ্চিত না হলে সংক্ষেপে সীমাবদ্ধতা জানাবে।
- উত্তর কাঠামো (যদি মানানসই হয়):
  1) সারাংশ (১–২ লাইন),
  2) বিস্তারিত ধাপ/ব্যাখ্যা,
  3) উদাহরণ (প্রযোজ্য হলে),
  4) টিপস/সতর্কতা (প্রযোজ্য হলে)।
- অতিরঞ্জন/অশালীন ভাষা নয়।
`;

const generationConfig = {
  temperature: 0.2,
  topP: 0.9,
  topK: 40,
  maxOutputTokens: 2048,
  candidateCount: 1,
};

// Simple slang detector
const SLANG_PATTERNS = [
  'vai','bhai','bro','boss','mama','dosto','dost',
  'lol','lmao','xD','xd','🤣','😂','😹','😅',
  'faltu','fokinni','ghapla','vela','kharap vibe'
];
function hasSlang(text) {
  const t = (text || '').toLowerCase();
  return SLANG_PATTERNS.some(w => t.includes(w));
}

// Identity / attribution detector
const IDENTITY_REGEX = new RegExp(
  [
    'tumi ke','apni ke','ke tumi','who are you','who r u',
    'who made you','owner ke','ke ban(iy|e|a)ch','ke toiri',
    'তুমি কে','আপনি কে','কে তুমি','কে বানিয়েছে','কে বানিয়েছে','কে তৈরি করেছে','তোমাকে কে'
  ].join('|'),
  'i'
);

// Build final prompt (no ambiguity preface)
function buildFinalPrompt(userText) {
  return `${SYSTEM_PROMPT}

ব্যবহারকারীর বার্তা:
${userText}

অনুস্মারক: সব উত্তর বাংলায় ও সংক্ষিপ্ত-সুস্পষ্টভাবে দেবে।`;
}

// ---------- Routes ----------

// Core: { text } -> { answer }
app.post('/api/ask', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }

    const raw = text.trim();

    // Fixed identity reply
    if (IDENTITY_REGEX.test(raw)) {
      const answer =
`**সারাংশ:** আমি একটি সহায়ক সহকারী।
**বিস্তারিত:** আমাকে বানিয়েছে smartprostuti। BOLDA আমায় Smart Prosthuti’র Tech Lead বানিয়েছেন। আপনার প্রযুক্তিগত ও ব্যবহারিক সহায়তায় পাশে আছি।`;
      return res.json({ answer });
    }

    // Prepare model with systemInstruction (if supported)
    let model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const prompt = buildFinalPrompt(raw);
    let result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    });
    let modelAnswer = result?.response?.text?.() || '';

    // Retry once if empty
    if (!modelAnswer || !modelAnswer.trim()) {
      model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig,
      });
      modelAnswer = result?.response?.text?.() || 'দুঃখিত, আমি কোনো উত্তর পাইনি।';
    }

    // Slang advice (optional prepend)
    if (hasSlang(raw)) {
      const advice =
`💡 **ভাষা নিয়ে পরামর্শ**
- অনুগ্রহ করে স্ল্যাং/অপভাষা পরিহার করুন—বিশেষত অফিসিয়াল/পেশাদার প্রসঙ্গে।
- ভদ্র ও নির্দিষ্ট বাক্য ব্যবহার করলে উত্তর আরও নির্ভুল ও দ্রুত পাওয়া যায়।`;
      modelAnswer = `${advice}\n\n${modelAnswer}`;
    }

    return res.json({ answer: modelAnswer });

  } catch (err) {
    console.error('ask error:', err);
    res.status(500).json({ error: 'failed to generate answer' });
  }
});

// Health
app.get('/', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});


