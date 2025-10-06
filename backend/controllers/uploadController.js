// backend/controllers/uploadController.js

const fs = require('fs').promises; // Use promise-based FS
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const db = require('../config/db');
const { getEmbedding, cosineSimilarity, generateSummary } = require('../services/aiService');

// 🔧 Helper: Extract text from PDF or DOCX
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    const buffer = await fs.readFile(filePath); // Use async file reading

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

// 🔧 Helper: Calculate plagiarism score
function calculatePlagiarismScore(similarities) {
  if (!similarities.length) return 0;
  
  // Use the highest similarity as plagiarism score
  const highestSimilarity = Math.max(...similarities.map(s => s.similarity));
  return parseFloat((highestSimilarity * 100).toFixed(2)); // Convert to percentage
}

// 🔧 Helper: Clean up uploaded file after processing
async function cleanupFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.warn('Could not delete temporary file:', filePath);
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

    // 2️⃣ Generate embedding for assignment text
    const assignmentEmbedding = await getEmbedding(text);

    // 3️⃣ Load academic sources and compare
    const [sources] = await db.execute('SELECT id, title, authors, abstract, embedding FROM academic_sources');
    const similarities = [];

    for (let source of sources) {
      try {
        const sourceEmbedding = JSON.parse(source.embedding);
        const similarity = cosineSimilarity(assignmentEmbedding, sourceEmbedding);

        if (similarity > 0.75) {
          similarities.push({
            id: source.id,
            title: source.title,
            authors: source.authors,
            similarity: parseFloat(similarity.toFixed(4)),
            abstract: source.abstract
          });
        }
      } catch (error) {
        console.warn(`Skipping source ${source.id}: Invalid embedding format`);
      }
    }

    // Sort by similarity (highest first)
    similarities.sort((a, b) => b.similarity - a.similarity);

    // 4️⃣ AI Analysis (RAG-style)
    const analysisResult = await generateSummary(text, similarities.slice(0, 5));
    
    // Parse the AI response (assuming it returns JSON)
    let analysisData;
    try {
      analysisData = typeof analysisResult === 'string' 
        ? JSON.parse(analysisResult) 
        : analysisResult;
    } catch (parseError) {
      // Fallback if AI returns plain text
      analysisData = {
        topic: 'General Assignment',
        academic_level: 'Undergraduate',
        key_themes: ['Content analysis required'],
        research_suggestions: analysisResult || 'Further research recommended',
        citation_recommendations: 'APA, MLA'
      };
    }

    // 5️⃣ Calculate plagiarism score
    const plagiarismScore = calculatePlagiarismScore(similarities);

    // 6️⃣ Insert assignment into DB
    const [assignmentResult] = await db.execute(
      `INSERT INTO assignments 
        (student_id, filename, original_text, topic, academic_level, word_count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        studentId, 
        file.originalname, // Store original filename
        text, 
        analysisData.topic || 'Unknown Topic',
        analysisData.academic_level || 'Unknown Level',
        wordCount
      ]
    );

    const assignmentId = assignmentResult.insertId;

    // 7️⃣ Insert analysis result
    await db.execute(
      `INSERT INTO analysis_results
        (assignment_id, suggested_sources, plagiarism_score, flagged_sections,
         research_suggestions, citation_recommendations, confidence_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        assignmentId,
        JSON.stringify(similarities.slice(0, 5)), // Top 5 sources
        plagiarismScore,
        JSON.stringify(analysisData.flagged_sections || []),
        analysisData.research_suggestions || 'No specific suggestions',
        analysisData.citation_recommendations || 'APA, MLA',
        analysisData.confidence_score || 0.8
      ]
    );

    // 8️⃣ Clean up uploaded file
    await cleanupFile(filePath);

    res.status(200).json({
      success: true,
      message: 'Assignment uploaded and analyzed successfully',
      data: {
        assignmentId,
        filename: file.originalname,
        wordCount,
        plagiarismScore: `${plagiarismScore}%`,
        suggestedSourcesCount: Math.min(similarities.length, 5),
        topic: analysisData.topic,
        academicLevel: analysisData.academic_level
      }
    });

  } catch (err) {
    // Clean up file on error
    if (filePath) {
      await cleanupFile(filePath).catch(cleanupError => {
        console.warn('Cleanup failed:', cleanupError);
      });
    }
    
    console.error('Upload Error:', err);
    
    const errorMessage = err.message.includes('Text extraction') 
      ? 'File processing failed. Please check file format.'
      : 'Server error during upload and analysis';

    res.status(500).json({ 
      success: false,
      message: errorMessage 
    });
  }
};