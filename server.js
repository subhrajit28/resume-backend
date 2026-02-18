const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/analyze', async (req, res) => {
  const { pdfBase64, jobDescription } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF provided' });

  const prompt = `You are an expert resume coach. Analyze this resume PDF.
${jobDescription ? `The job the candidate is applying for:\n${jobDescription}` : 'No specific job — do a general analysis. Set jobMatchScore to null.'}

Respond with ONLY a valid JSON object. No markdown, no backticks, no explanation. Just the raw JSON.

Use this exact shape:
{"overallScore":75,"summary":"Short summary here.","candidateName":"Name Here","currentRole":"Most recent job title","yearsExperience":"X years","education":"Degree and field","radarScores":[{"subject":"Impact","score":70},{"subject":"Skills","score":80},{"subject":"Experience","score":75},{"subject":"Clarity","score":65},{"subject":"Keywords","score":60}],"skillsFound":["Python","SQL","Git"],"skillsMissing":["Docker","AWS"],"jobMatchScore":72,"jobMatchBreakdown":[{"label":"Technical Skills","score":80},{"label":"Experience Level","score":70},{"label":"Domain Knowledge","score":65},{"label":"Soft Skills","score":75}],"improvements":[{"title":"Quantify Achievements","text":"Add specific numbers and metrics to show impact."},{"title":"Stronger Summary","text":"Write a compelling 2-3 line professional summary at the top."}]}`;

  try {
    const GEMINI_KEY = process.env.GEMINI_KEY;
    if (!GEMINI_KEY) throw new Error('GEMINI_KEY not configured');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: 'application/pdf',
                  data: pdfBase64
                }
              },
              { text: prompt }
            ]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2000
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
