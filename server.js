const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Extract text from PDF base64 using simple parsing
function extractTextFromPDF(base64) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const str = buffer.toString('latin1');
    
    // Extract readable text between PDF stream markers
    const textParts = [];
    const streamRegex = /stream([\s\S]*?)endstream/g;
    let match;
    
    while ((match = streamRegex.exec(str)) !== null) {
      const content = match[1];
      // Extract text between parentheses (PDF text encoding)
      const textRegex = /\(([^)]+)\)/g;
      let textMatch;
      while ((textMatch = textRegex.exec(content)) !== null) {
        const text = textMatch[1].replace(/\\n/g, ' ').replace(/\\/g, '').trim();
        if (text.length > 1 && /[a-zA-Z]/.test(text)) {
          textParts.push(text);
        }
      }
    }
    
    // Also try extracting plain readable ASCII text
    const readable = str.replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .split(' ')
      .filter(w => w.length > 2 && /[a-zA-Z]/.test(w))
      .join(' ');
    
    const combined = textParts.join(' ') + ' ' + readable;
    return combined.slice(0, 8000); // Limit to 8000 chars for Groq context
  } catch (e) {
    return 'Could not extract PDF text: ' + e.message;
  }
}

app.post('/analyze', async (req, res) => {
  const { pdfBase64, jobDescription } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF provided' });

  const GROQ_KEY = process.env.GROQ_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_KEY not configured' });

  // Extract text from PDF
  const resumeText = extractTextFromPDF(pdfBase64);

  const prompt = `You are an expert resume coach. Analyze the following resume text carefully.

RESUME TEXT:
${resumeText}

${jobDescription ? `The job the candidate is applying for:\n${jobDescription}` : 'No specific job — do a general analysis. Set jobMatchScore to null.'}

Respond with ONLY a valid JSON object. No markdown, no backticks, no explanation. Just raw JSON.

Use this exact shape:
{"overallScore":75,"summary":"Short 2-3 sentence summary.","candidateName":"Name Here","currentRole":"Most recent job title","yearsExperience":"X years","education":"Degree and field","radarScores":[{"subject":"Impact","score":70},{"subject":"Skills","score":80},{"subject":"Experience","score":75},{"subject":"Clarity","score":65},{"subject":"Keywords","score":60}],"skillsFound":["Python","SQL","Git"],"skillsMissing":["Docker","AWS"],"jobMatchScore":72,"jobMatchBreakdown":[{"label":"Technical Skills","score":80},{"label":"Experience Level","score":70},{"label":"Domain Knowledge","score":65},{"label":"Soft Skills","score":75}],"improvements":[{"title":"Quantify Achievements","text":"Add specific numbers and metrics to show impact."},{"title":"Stronger Summary","text":"Write a compelling 2-3 line professional summary at the top."},{"title":"Keywords","text":"Add more industry-relevant keywords to pass ATS filters."}]}`;

  try {
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
