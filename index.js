// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// CORS (প্রয়োজনে ডোমেইন বাড়াতে পারো)
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

// ----------------- Tuned Behaviors -----------------

// A) Strong System Prompt (Bangla, structured, factual)
const SYSTEM_PROMPT = `
তুমি একজন সহায়ক সহকারী। সবসময় স্পষ্ট, প্রাকৃতিক বাংলায় উত্তর দেবে।
নীতিমালা:
- অনুমানভিত্তিক তথ্য এড়িয়ে চলো; নিশ্চিত না হলে "আমি নিশ্চিত নই" বলবে এবং কীভাবে নিশ্চিত হওয়া যায়—সেটা বলবে।
- প্রশ্ন অস্পষ্ট হলে প্রথমে ২–৩টি স্পষ্টকরণ প্রশ্ন করবে। তারপর যুক্তিযুক্ত অনুমান ধরে "সম্ভাব্য উত্তর (ধরা-ধরি)" দেবে।
- উত্তর কাঠামো: 
  1) সারাংশ (এক-দুই লাইনে),
  2) বিস্তারিত ব্যাখ্যা/ধাপ,
  3) উদাহরণ (যদি প্রযোজ্য),
  4) টিপস/সতর্কতা বা সীমাবদ্ধতা (যদি প্রযোজ্য)।
- তুলনা/লিস্ট দরকার হলে বুলেট/টেবিল ব্যবহার করো।
- সংখ্যা/তারিখ/ইউনিট—চাওয়া হলে নির্দিষ্টভাবে দাও।
- অতিরঞ্জন/অশালীন ভাষা পরিহার করো।
`;

// B) Slang detector (simple heuristic)
const SLANG_PATTERNS = [
  'vai','bhai','bro','boss','mama','dosto','dost',
  'lol','lmao','xD','xd','🤣','😂','😹','😅',
  'faltu','fokinni','ghapla','vela','kharap vibe'
];
function hasSlang(text) {
  const t = (text || '').toLowerCase();
  return SLANG_PATTERNS.some(w => t.includes(w));
}

// C) Identity/attribution detector
const IDENTITY_REGEX = new RegExp(
  [
    'tumi ke','apni ke','ke tumi','who are you','who r u',
    'who made you','owner ke',
    'ke ban(iy|e|a)ch','ke toiri',
    'তুমি কে','আপনি কে','কে তুমি','কে বানিয়েছে','কে বানিয়েছে','কে তৈরি করেছে','তোমাকে কে'
  ].join('|'),
  'i'
);

// D) Ambiguity detector (short or generic questions)
function isAmbiguous(q) {
  const clean = (q || '').replace(/\s+/g, ' ').trim();
  const wordCount = clean.split(' ').filter(Boolean).length;
  const genericTriggers = ['কিভাবে করব','কী করব','কি করব','help','সাহায্য','how to','what to do'];
  const hasGeneric = genericTriggers.some(t => clean.toLowerCase().includes(t));
  return wordCount < 6 || hasGeneric;
}

// E) Build final prompt per user text
function buildFinalPrompt(userText) {
  return `${SYSTEM_PROMPT}

ব্যবহারকারীর বার্তা:
${userText}

অনুস্মারক: সব উত্তর উপরের কাঠামো ও বাংলায় দেবে।`;
}

// F) Gemini generation config — more deterministic, long answers allowed
const generationConfig = {
  temperature: 0.2,
  topP: 0.9,
  topK: 40,
  maxOutputTokens: 2048,
  candidateCount: 1,
};

// ----------------- Route -----------------

// ইনপুট: { text } → আউটপুট: { answer }
app.post('/api/ask', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text (string) is required' });
    }

    const raw = text.trim();

    // 1) Identity/attribution → fixed reply (chatgpt-like persona answer)
    if (IDENTITY_REGEX.test(raw)) {
      const answer =
`**সারাংশ:** আমি একটি সহায়ক সহকারী।
**বিস্তারিত:** আমায় Smart Prosthuti’র Tech Lead বানিয়েছেন। আপনাকে প্রযুক্তিগত ও ব্যবহারিক সহায়তা দেওয়াই আমার লক্ষ্য।
**টিপস:** আপনি কী বিষয়ে সাহায্য চান—একটু নির্দিষ্ট করে বললে দ্রুত ও সঠিকভাবে সাহায্য করতে পারব।`;
      return res.json({ answer });
    }

    // 2) Prepare model
    // Prefer systemInstruction if SDK supports; fallback via content prompt.
    let model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      // systemInstruction is supported in newer SDKs; harmless if ignored.
      systemInstruction: SYSTEM_PROMPT,
    });

    // 3) Build prompt and call model
    const prompt = buildFinalPrompt(raw);

    let result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig });
    let modelAnswer = result?.response?.text?.() || '';

    // 4) Retry once if empty (rare network/model blip)
    if (!modelAnswer || modelAnswer.trim().length === 0) {
      model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig });
      modelAnswer = result?.response?.text?.() || 'দুঃখিত, আমি কোনো উত্তর পাইনি।';
    }

    // 5) If ambiguous → prepend clarification questions + tentative answer header
    if (isAmbiguous(raw)) {
      const clar = 
`🔎 **আপনার প্রশ্নটি একটু অস্পষ্ট লাগছে। অনুগ্রহ করে নিশ্চিত করবেন:**
1) আপনি ঠিক কোন কাজ/বিষয়টি করতে চান?
2) কোন প্ল্যাটফর্ম/ডিভাইসে (ওয়েব/মোবাইল/উইন্ডোজ/লিনাক্স)?
3) কোনো নির্দিষ্ট সীমাবদ্ধতা/ডেটা/ফর্ম্যাট আছে কি?

**সম্ভাব্য উত্তর (ধরা-ধরি):**`;
      modelAnswer = `${clar}\n\n${modelAnswer}`;
    }

    // 6) Slang advice → prepend guidance
    if (hasSlang(raw)) {
      const advice =
`💡 **ভাষা নিয়ে ছোট্ট পরামর্শ**
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
