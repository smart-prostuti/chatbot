// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// CORS (প্রয়োজনে তোমার ফ্রন্টএন্ড ডোমেইন যোগ করো)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://smartprostuti.netlify.app',
  'https://smartprostuti.com',
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
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

// -------- Helpers --------

// 1) সবসময় স্পষ্ট বাংলায় উত্তর দিতে বেস প্রম্পট
function baseBanglaPrompt(userText) {
  return `
নির্দেশনা: নিম্নের বার্তার উত্তর স্পষ্ট, শুদ্ধ ও প্রাকৃতিক বাংলায় দাও।
- যেখানে প্রয়োজন, ছোট ছোট অনুচ্ছেদ বা পয়েন্ট ব্যবহার করো।
- টেকনিক্যাল শব্দ থাকলে বাংলায় বুঝিয়ে বলো (প্রয়োজনে বন্ধনীতে ইংরেজি রূপ দাও)।
ব্যবহারকারীর বার্তা:
${userText}
`;
}

// 2) স্ল্যাং ডিটেকশন (সহজ হিউরিস্টিক)
const SLANG_PATTERNS = [
  'vai', 'bhai', 'bro', 'boss', 'mama', 'dosto', 'dost',
  'lol', 'lmao', 'xD', 'xd', '😂', '😹', '🤣', '😅',
  'faltu', 'fokinni', 'ghapla', 'vela', 'kharap vibe'
];
function hasSlang(text) {
  const t = (text || '').toLowerCase();
  return SLANG_PATTERNS.some(w => t.includes(w));
}

// 3) পরিচয়/উৎস-সংক্রান্ত প্রশ্ন ডিটেকশন
const IDENTITY_REGEX = new RegExp(
  [
    'tumi ke', 'apni ke', 'ke tumi', 'who are you', 'who r u',
    'ke ban(iy|e|a)ch', 'ke toiri', 'who made you', 'owner ke',
    'tomake ke', 'তুমি কে', 'আপনি কে', 'কে তুমি', 'কে বানিয়েছে', 'কে बनিয়েছে', 'কে তৈরি করেছে',
    'কে বানাইছে', 'কে বানাইছে', 'তোমাকে কে', 'কে বানিয়েছে', 'কে তৈরী করেছে', 'তোমাকে কে বানিয়েছে'
  ].join('|'),
  'i'
);

// -------- Route --------

// ইনপুট: { text } → আউটপুট: { answer }
app.post('/api/ask', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }

    const raw = text.trim();

    // (A) পরিচয়/উৎস: সরাসরি কাস্টম উত্তর
    if (IDENTITY_REGEX.test(raw)) {
      const answer =
        "আমার পরিচয়: আমি আপনার সহায়ক সহকারী।\n" +
        "BOLDA আমায় Smart Prosthuti’র Tech Lead বানিয়েছেন।\n" +
        "আপনার যে কোনো প্রযুক্তিগত সহায়তায় আমি পাশে আছি।";
      return res.json({ answer });
    }

    // (B) সাধারণ প্রশ্ন: বাংলায় উত্তর দিবে
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = baseBanglaPrompt(raw);
    const result = await model.generateContent(prompt);
    const modelAnswer = result?.response?.text?.() || 'দুঃখিত, আমি কোনো উত্তর পাইনি।';

    // (C) স্ল্যাং থাকলে—উত্তরের আগে উপদেশ যোগ
    if (hasSlang(raw)) {
      const advice =
        "💡 ছোট্ট পরামর্শ:\n" +
        "• অনুগ্রহ করে স্ল্যাং/অপভাষা এড়িয়ে চলুন—বিশেষ করে অফিসিয়াল বা পেশাদার কথোপকথনে।\n" +
        "• ভদ্র সম্বোধন ব্যবহার করুন, যেমন: “আপনি”, “দয়া করে”, “ধন্যবাদ”।\n" +
        "• এতে আপনার বার্তা আরও স্পষ্ট ও গ্রহণযোগ্য হয়।\n\n" +
        "এখন আপনার প্রশ্নের উত্তর:";
      return res.json({ answer: `${advice}\n\n${modelAnswer}` });
    }

    // (D) ডিফল্ট—মডেলের বাংলা উত্তর ফেরত
    return res.json({ answer: modelAnswer });

  } catch (err) {
    console.error('ask error:', err);
    res.status(500).json({ error: 'failed to generate answer' });
  }
});

// Health (optional)
app.get('/', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
