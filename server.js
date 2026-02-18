const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const pdfParse = require('pdf-parse');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Groq client once
const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Extract text from base64 PDF
async function extractTextFromPDF(base64) {
  const buffer = Buffer.from(base64, 'base64');
  const data = await pdfParse(buffer);
  return data.text?.trim() || '';
}

// Build the analysis prompt
function buildPrompt(resumeText, jobDescription) {
  const jobContext = jobDescription
    ? `The job the candidate is applying for:\n${jobDescription}`
    : 'No specific job — do a general analysis. Set jobMatchScore to null.';

  return `You are an expert resume coach. Analyze the resume below.

${jobContext}

Resume Content:
"""
${resumeText}
"""

Respond with ONLY a valid JSON object. No markdown, no backticks, no explanation. Just raw JSON.
Use this exact shape:
{
  "overallScore": 75,
  "summary": "Short summary here.",
  "candidateName": "Name Here",
  "currentRole": "Most recent job title",
  "yearsExperience": "X years",
  "education": "Degree and field",
  "radarScores": [
    {"subject": "Impact", "score": 70},
    {"subject": "Skills", "score": 80},
    {"subject": "Experience", "score": 75},
    {"subject": "Clarity", "score": 65},
    {"subject": "Keywords", "score": 60}
  ],
  "skillsFound": ["Python", "SQL", "Git"],
  "skillsMissing": ["Docker", "AWS"],
  "jobMatchScore": 72,
  "jobMatchBreakdown": [
    {"label": "Technical Skills", "score": 80},
    {"label": "Experience Level", "score": 70},
    {"label": "Domain Knowledge", "score": 65},
    {"label": "Soft Skills", "score": 75}
  ],
  "improvements": [
    {"title": "Quantify Achievements", "text": "Add specific numbers and metrics to show impact."},
    {"title": "Stronger Summary", "text": "Write a compelling 2-3 line professional summary at the top."}
  ]
}`;
}

// Call Groq API
async function analyzeWithGroq(prompt) {
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.choices[0]?.message?.content || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No valid JSON in response: ' + text.slice(0, 200));

  return JSON.parse(jsonMatch[0]);
}

// Main route
app.post('/analyze', async (req, res) => {
  const { pdfBase64, jobDescription } = req.body;

  if (!pdfBase64) {
    return res.status(400).json({ error: 'No PDF provided' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured' });
  }

  try {
    console.log('📄 Extracting text from PDF...');
    const resumeText = await extractTextFromPDF(pdfBase64);

    if (!resumeText || resumeText.length < 50) {
      return res.status(422).json({ error: 'Could not extract readable text from PDF. Please upload a text-based PDF.' });
    }

    console.log(`✅ Extracted ${resumeText.length} characters. Sending to Groq...`);
    const prompt = buildPrompt(resumeText, jobDescription);
    const result = await analyzeWithGroq(prompt);

    console.log('✅ Analysis complete.');
    res.json(result);

  } catch (e) {
    console.error('❌ Error:', e.message);

    if (e.message.includes('rate_limit') || e.message.includes('quota')) {
      return res.status(429).json({ error: 'Rate limit reached. Please try again in a moment.' });
    }

    if (e instanceof SyntaxError) {
      return res.status(500).json({ error: 'Failed to parse AI response as JSON.' });
    }

    res.status(500).json({ error: e.message || 'Something went wrong.' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
