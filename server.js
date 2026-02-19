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
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const pdfData = await pdfParse(pdfBuffer);
    const resumeText = pdfData.text.slice(0, 8000);

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract text from PDF. Please make sure it is not a scanned image.' });
    }

    const prompt = `You are an expert resume coach and ATS specialist. Analyze the following resume text carefully and thoroughly.

RESUME TEXT:
${resumeText}

${jobDescription ? `The job the candidate is applying for:\n${jobDescription}` : 'No specific job — do a general analysis. Set jobMatchScore to null.'}

Respond with ONLY a valid JSON object. No markdown, no backticks, no explanation. Just raw JSON.

Use EXACTLY this shape:
{
  "overallScore": 72,
  "summary": "2-3 sentence executive summary of the resume quality.",
  "candidateName": "Full Name",
  "currentRole": "Most recent job title",
  "yearsExperience": "X years",
  "education": "Degree and field",
  "industryTip": "One specific tip for the candidate's industry or target role.",
  "radarScores": [
    {"subject":"Impact","score":70},
    {"subject":"Skills","score":80},
    {"subject":"Experience","score":75},
    {"subject":"Clarity","score":65},
    {"subject":"Keywords","score":60}
  ],
  "skillsFound": ["Python","SQL","Git"],
  "skillsMissing": ["Docker","AWS","Kubernetes"],
  "jobMatchScore": 72,
  "jobMatchBreakdown": [
    {"label":"Technical Skills","score":80},
    {"label":"Experience Level","score":70},
    {"label":"Domain Knowledge","score":65},
    {"label":"Soft Skills","score":75}
  ],
  "sections": [
    {
      "name": "Professional Summary",
      "score": 0,
      "description": "No professional summary found. This is critical for making a strong first impression.",
      "recommendations": ["Add a 2-3 line professional summary at the top", "Include your key skills and career goals"]
    },
    {
      "name": "Contact Information",
      "score": 90,
      "description": "Contact information is complete with multiple professional links.",
      "recommendations": ["Consider adding location for geographic context", "Hyperlink your email and LinkedIn"]
    },
    {
      "name": "Work Experience",
      "score": 75,
      "description": "Work experience section shows relevant roles but lacks quantified achievements.",
      "recommendations": ["Add metrics and numbers to bullet points", "Use strong action verbs to start each bullet"]
    },
    {
      "name": "Education",
      "score": 85,
      "description": "Education section is clear with relevant degrees listed.",
      "recommendations": ["Add expected graduation date if ongoing", "Include relevant coursework if space allows"]
    },
    {
      "name": "Skills Section",
      "score": 80,
      "description": "Skills are relevant and well categorized.",
      "recommendations": ["Separate technical and soft skills more distinctly", "Add proficiency levels for technical skills"]
    },
    {
      "name": "Formatting",
      "score": 70,
      "description": "Overall formatting is clean but some inconsistencies exist.",
      "recommendations": ["Standardize bullet point styles", "Ensure consistent font sizes across sections", "Align dates uniformly"]
    },
    {
      "name": "ATS Compatibility",
      "score": 65,
      "description": "Resume may face ATS parsing issues due to formatting.",
      "recommendations": ["Avoid tables and complex formatting", "Use standard section headings", "Save as plain PDF"]
    },
    {
      "name": "Keywords",
      "score": 70,
      "description": "Some industry keywords present but more needed.",
      "recommendations": ["Add more role-specific technical keywords", "Mirror language from job descriptions", "Include acronyms and full forms"]
    }
  ],
  "priorities": {
    "high": [
      "Add a professional summary at the top of the resume.",
      "Correct any date inconsistencies in the experience section.",
      "Standardize formatting throughout the document."
    ],
    "medium": [
      "Enhance keyword optimization with more role-specific terms.",
      "Quantify achievements and project impacts where possible.",
      "Avoid complex formatting that may hinder ATS parsing."
    ],
    "low": [
      "Add location to contact information.",
      "Include proficiency levels for technical skills.",
      "Add hyperlinks to email and LinkedIn."
    ]
  },
  "nextSteps": [
    "Add a compelling professional summary at the very top of your resume.",
    "Go through each bullet point and add a number or metric to show impact.",
    "Standardize all date formats throughout the resume (e.g., Jan 2023 - Mar 2024).",
    "Run your resume through an ATS checker to identify parsing issues.",
    "Tailor your skills section to match keywords from job descriptions you apply to.",
    "Have a peer or mentor review the resume for clarity and flow.",
    "Save the final version as a clean, single-column PDF before submitting."
  ]
}

Important: Fill in ALL fields with real analysis based on the actual resume content. Do not use the example values above — analyze the actual resume and provide accurate scores and feedback.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an expert resume coach. Always respond with valid JSON only. No markdown, no backticks, no extra text.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 3000
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
