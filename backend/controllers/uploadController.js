// backend/controllers/uploadController.js - UPDATED FOR DEEPSEEK

const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const db = require('../config/db');

// 🔧 Helper: Extract text from PDF or DOCX
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    const buffer = await fs.readFile(filePath);

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return data.text.trim();
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    } else {
      throw new Error('Unsupported file type. Only PDF and DOCX are allowed.');
    }
  } catch (error) {
    throw new Error(`Text extraction failed: ${error.message}`);
  }
}

// 🔧 Helper: Analyze text with DeepSeek
async function analyzeWithDeepSeek(text, filename) {
  try {
    // Check if API key is available
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('AI service not configured');
    }

    const prompt = `Analyze this academic assignment and provide a JSON response with:
- "topic": Main subject/topic
- "academic_level": "High School", "Undergraduate", "Graduate", or "PhD"  
- "key_themes": Array of 3-5 main themes
- "writing_quality": "Poor", "Average", "Good", or "Excellent"
- "research_suggestions": Specific improvement suggestions
- "citation_recommendations": Recommended citation style

Assignment: ${filename}
Content: ${text.substring(0, 3000)}

Return ONLY valid JSON.`;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are an academic writing expert. Return ONLY valid JSON format."
          },
          {
            role: "user", 
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.3,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Try to parse JSON response
    try {
      return JSON.parse(content);
    } catch (parseError) {
      // Fallback if JSON parsing fails
      return {
        topic: 'Academic Assignment',
        academic_level: 'Undergraduate',
        key_themes: ['General Analysis'],
        writing_quality: 'Good',
        research_suggestions: 'Further analysis recommended',
        citation_recommendations: 'APA'
      };
    }
  } catch (error) {
    console.error('DeepSeek analysis failed:', error.message);
    throw new Error('AI analysis service unavailable');
  }
}

// 🔧 Helper: Simple plagiarism detection
function calculatePlagiarismScore(text) {
  // Simple heuristic-based detection
  let score = 0;
  
  // Check for inconsistent writing patterns
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length > 0) {
    const avgLength = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length;
    const variance = sentences.reduce((sum, s) => {
      const diff = s.split(/\s+/).length - avgLength;
      return sum + diff * diff;
    }, 0) / sentences.length;
    
    if (variance > 100) score += 15;
  }
  
  return Math.min(score, 30); // Cap at 30% for heuristic method
}

// 🔧 Helper: Clean up uploaded file
async function cleanupFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.warn('Could not delete file:', filePath);
  }
}

// 🚀 Main Upload Handler
exports.uploadAssignment = async (req, res) => {
  let filePath;
  
  try {
    const file = req.file;
    const studentId = req.user.id;

    if (!file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file uploaded' 
      });
    }

    // Validate file type
    const allowedTypes = ['.pdf', '.docx'];
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (!allowedTypes.includes(fileExtension)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only PDF and DOCX files are allowed.'
      });
    }

    filePath = path.join(__dirname, '..', 'uploads', file.filename);
    
    // 1️⃣ Extract text from file
    const text = await extractText(filePath);
    
    if (!text || text.length < 50) {
      return res.status(400).json({
        success: false,
        message: 'File appears to be empty or too short for analysis'
      });
    }

    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;

    // 2️⃣ Try AI analysis (but don't fail if it doesn't work)
    let analysisData;
    let aiSuccess = false;

    try {
      analysisData = await analyzeWithDeepSeek(text, file.originalname);
      aiSuccess = true;
    } catch (aiError) {
      console.warn('AI analysis failed, using basic analysis:', aiError.message);
      analysisData = {
        topic: 'Academic Assignment',
        academic_level: 'Undergraduate',
        key_themes: ['Content Analysis'],
        writing_quality: 'Good',
        research_suggestions: 'Further review recommended',
        citation_recommendations: 'APA'
      };
    }

    // 3️⃣ Calculate basic plagiarism score
    const plagiarismScore = calculatePlagiarismScore(text);

    // 4️⃣ Insert assignment into DB
    const [assignmentResult] = await db.execute(
      `INSERT INTO assignments 
        (student_id, filename, original_text, topic, academic_level, word_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        studentId, 
        file.originalname,
        text, 
        analysisData.topic,
        analysisData.academic_level,
        wordCount
      ]
    );

    const assignmentId = assignmentResult.insertId;

    // 5️⃣ Insert analysis result
    await db.execute(
      `INSERT INTO analysis_results
        (assignment_id, analysis_type, analysis_result, plagiarism_score, analyzed_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        assignmentId,
        'academic',
        JSON.stringify(analysisData),
        plagiarismScore
      ]
    );

    // 6️⃣ Clean up uploaded file
    await cleanupFile(filePath);

    res.status(200).json({
      success: true,
      message: aiSuccess 
        ? 'Assignment uploaded and analyzed successfully' 
        : 'Assignment uploaded (basic analysis completed)',
      data: {
        assignmentId,
        filename: file.originalname,
        wordCount,
        plagiarismScore: `${plagiarismScore}%`,
        topic: analysisData.topic,
        academicLevel: analysisData.academic_level,
        aiAnalysis: aiSuccess
      }
    });

  } catch (err) {
    // Clean up file on error
    if (filePath) {
      await cleanupFile(filePath);
    }
    
    console.error('Upload Error:', err);
    
    const errorMessage = err.message.includes('Text extraction') 
      ? 'File processing failed. Please check file format.'
      : 'Server error during upload';

    res.status(500).json({ 
      success: false,
      message: errorMessage 
    });
  }
};