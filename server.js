const express = require('express');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/analyze', async (req, res) => {
  const { pdfBase64, jobDescription } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF provided' });

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_KEY not configured' });

  try {
    // Properly extract text from PDF using pdf-parse
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const pdfData = await pdfParse(pdfBuffer);
    const resumeText = pdfData.text.slice(0, 8000);

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract text from PDF. Please make sure it is not a scanned image.' });
    }

    const prompt = `You are an expert resume coach. Analyze the following resume text carefully.

RESUME TEXT:
${resumeText}

${jobDescription ? `The job the candidate is applying for:\n${jobDescription}` : 'No specific job — do a general analysis. Set jobMatchScore to null.'}

Respond with ONLY a valid JSON object. No markdown, no backticks, no explanation. Just raw JSON.

Use this exact shape:
{"overallScore":75,"summary":"Short 2-3 sentence summary.","candidateName":"Name Here","currentRole":"Most recent job title","yearsExperience":"X years","education":"Degree and field","radarScores":[{"subject":"Impact","score":70},{"subject":"Skills","score":80},{"subject":"Experience","score":75},{"subject":"Clarity","score":65},{"subject":"Keywords","score":60}],"skillsFound":["Python","SQL","Git"],"skillsMissing":["Docker","AWS"],"jobMatchScore":72,"jobMatchBreakdown":[{"label":"Technical Skills","score":80},{"label":"Experience Level","score":70},{"label":"Domain Knowledge","score":65},{"label":"Soft Skills","score":75}],"improvements":[{"title":"Quantify Achievements","text":"Add specific numbers and metrics to show impact."},{"title":"Stronger Summary","text":"Write a compelling 2-3 line professional summary at the top."},{"title":"Keywords","text":"Add more industry-relevant keywords to pass ATS filters."}]}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an expert resume coach. Always respond with valid JSON only. No markdown, no backticks, no explanation.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Groq API error ${response.status}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response: ' + text.slice(0, 200));

    res.json(JSON.parse(jsonMatch[0]));

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
