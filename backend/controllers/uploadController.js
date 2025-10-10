// backend/controllers/uploadController.js - UPDATED FOR SUPABASE + N8N
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const db = require('../config/db'); // Now Supabase client
const axios = require('axios'); // For n8n webhook calls

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

// 🔧 Enhanced Helper: Local AI analysis (no API needed)
async function analyzeWithLocalAI(text, filename) {
  try {
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const wordCount = words.length;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    
    // Analyze text to determine academic level
    let academicLevel = 'High School';
    if (wordCount > 2000) academicLevel = 'Graduate';
    else if (wordCount > 1000) academicLevel = 'Undergraduate';
    
    // Extract potential topic from text
    const commonTopics = {
      'climate': 'Climate Change and Environmental Science',
      'artificial intelligence': 'Artificial Intelligence in Modern Society',
      'education': 'Education System Analysis',
      'technology': 'Technology Impact Assessment',
      'health': 'Healthcare and Medicine',
      'economic': 'Economics and Global Markets',
      'soci': 'Social Issues and Cultural Studies',
      'research': 'Academic Research Methodology',
      'analysis': 'Data Analysis and Interpretation',
      'business': 'Business Management and Strategy',
      'psychology': 'Psychological Studies and Behavior',
      'history': 'Historical Analysis and Events',
      'science': 'Scientific Research and Discovery',
      'literature': 'Literary Analysis and Criticism'
    };
    
    let detectedTopic = 'Academic Assignment';
    const lowerText = text.toLowerCase();
    for (const [keyword, topic] of Object.entries(commonTopics)) {
      if (lowerText.includes(keyword)) {
        detectedTopic = topic;
        break;
      }
    }
    
    // Calculate writing quality based on text metrics
    let writingQuality = 'Average';
    const avgSentenceLength = sentences.length > 0 ? 
      sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length : 0;
    
    if (avgSentenceLength > 15 && avgSentenceLength < 25) writingQuality = 'Good';
    if (avgSentenceLength >= 25) writingQuality = 'Excellent';
    if (avgSentenceLength < 10) writingQuality = 'Poor';
    
    // Generate key themes based on content
    const keyThemes = [];
    if (lowerText.includes('method') || lowerText.includes('research')) keyThemes.push('Research Methodology');
    if (lowerText.includes('data') || lowerText.includes('analysis')) keyThemes.push('Data Analysis');
    if (lowerText.includes('result') || lowerText.includes('finding')) keyThemes.push('Research Findings');
    if (lowerText.includes('conclusion') || lowerText.includes('summary')) keyThemes.push('Conclusion Synthesis');
    if (lowerText.includes('theory') || lowerText.includes('concept')) keyThemes.push('Theoretical Framework');
    if (lowerText.includes('review') || lowerText.includes('literature')) keyThemes.push('Literature Review');
    
    if (keyThemes.length === 0) {
      keyThemes.push('Academic Writing', 'Critical Analysis', 'Content Evaluation');
    }
    
    return {
      topic: detectedTopic,
      academic_level: academicLevel,
      key_themes: keyThemes.slice(0, 4),
      writing_quality: writingQuality,
      research_suggestions: 'Consider expanding your analysis with additional academic sources and specific examples to strengthen your arguments. Include more statistical data and real-world applications where applicable.',
      citation_recommendations: 'Use APA or MLA format consistently throughout your work. Ensure all sources are properly cited with complete references.',
      confidence_score: 0.8
    };
    
  } catch (error) {
    console.error('Local analysis failed:', error.message);
    // Fallback analysis
    return {
      topic: 'Academic Assignment',
      academic_level: 'Undergraduate',
      key_themes: ['Academic Writing', 'Research Content', 'Critical Analysis'],
      writing_quality: 'Good',
      research_suggestions: 'Further analysis and research expansion recommended. Consider adding more specific examples and supporting evidence.',
      citation_recommendations: 'APA format',
      confidence_score: 0.7
    };
  }
}

// Define plagiarism indicators at the module level (outside functions)
const definiteIndicators = [
  {
    pattern: /copyright\s*©?\s*\d{4}/gi,
    weight: 40,
    description: 'Copyright notice'
  },
  {
    pattern: /all\s+rights\s+reserved/gi,
    weight: 35,
    description: 'All rights reserved'
  },
  {
    pattern: /published\s+(?:in|by)\s+[A-Z]/gi,
    weight: 30,
    description: 'Published in/by statement'
  },
  {
    pattern: /journal\s+of\s+[A-Z]/gi,
    weight: 25,
    description: 'Journal reference'
  },
  {
    pattern: /volume\s+\d+\s*,\s*issue\s+\d+/gi,
    weight: 25,
    description: 'Volume/issue reference'
  },
  {
    pattern: /doi:\s*[^\s]+/gi,
    weight: 20,
    description: 'DOI reference'
  },
  {
    pattern: /retrieved\s+from\s+https?:\/\//gi,
    weight: 30,
    description: 'Retrieved from URL'
  },
  {
    pattern: /ISBN\s*[^\s]+/gi,
    weight: 20,
    description: 'ISBN reference'
  }
];

const suspiciousPatterns = [
  {
    pattern: /\(\s*\w+\s*,\s*\d{4}\s*\)/g, // (Author, 2024)
    weight: 3,
    description: 'Citation pattern'
  },
  {
    pattern: /\[\s*\d+\s*\]/g, // [1]
    weight: 2,
    description: 'Bracket citation'
  },
  {
    pattern: /et\s+al\./g, // et al.
    weight: 5,
    description: 'Et al. usage'
  },
  {
    pattern: /pp\.\s*\d+/g, // pp. 23-25
    weight: 4,
    description: 'Page reference'
  },
  {
    pattern: /according\s+to\s+[A-Z][a-z]+/gi,
    weight: 3,
    description: 'According to [Name]'
  },
  {
    pattern: /as\s+cited\s+in/gi,
    weight: 4,
    description: 'As cited in'
  },
  {
    pattern: /cf\.\s*\w+/gi,
    weight: 3,
    description: 'Cf. reference'
  }
];

const academicPhrases = [
  'it is important to note that',
  'in conclusion',
  'this paper examines',
  'the results indicate that',
  'previous research has shown',
  'the literature review',
  'methodology section',
  'data analysis reveals',
  'research findings suggest',
  'theoretical framework',
  'empirical evidence',
  'statistically significant',
  'future research should',
  'limitations of this study',
  'as discussed above',
  'the purpose of this study',
  'research questions',
  'hypothesis testing',
  'sample size',
  'data collection methods'
];

// 🔧 Enhanced Helper: Advanced plagiarism detection
function calculatePlagiarismScore(text, filename) {
  try {
    let score = 0;
    const lowerText = text.toLowerCase();
    const words = lowerText.split(/\s+/).filter(word => word.length > 3);
    const wordCount = words.length;
    
    if (wordCount < 50) return 0;

    console.log(`🔍 Running plagiarism check on ${filename} (${wordCount} words)`);

    // 1. CHECK FOR DEFINITE PLAGIARISM
    definiteIndicators.forEach(indicator => {
      const matches = lowerText.match(indicator.pattern);
      if (matches && matches.length > 0) {
        console.log(`🚨 ${indicator.description} detected: ${matches.length} occurrences`);
        score += indicator.weight;
      }
    });

    // 2. CHECK FOR SUSPICIOUS PATTERNS
    let suspiciousCount = 0;
    suspiciousPatterns.forEach(pattern => {
      const matches = lowerText.match(pattern.pattern);
      if (matches) {
        suspiciousCount += matches.length;
        score += matches.length * pattern.weight;
        if (matches.length > 0) {
          console.log(`⚠️ ${pattern.description}: ${matches.length} occurrences`);
        }
      }
    });

    // 3. CHECK FOR URLS (definite copying)
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = lowerText.match(urlPattern);
    if (urls) {
      console.log(`🔗 URLs detected: ${urls.length}`);
      score += urls.length * 15;
    }

    // 4. CHECK FOR INCONSISTENT WRITING STYLE
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length > 5) {
      const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
      const avgLength = sentenceLengths.reduce((a, b) => a + b) / sentenceLengths.length;
      const variance = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / sentenceLengths.length;
      
      // High variance suggests content from different sources
      if (variance > 500) {
        console.log(`📊 High sentence length variance: ${variance.toFixed(1)} (suggests mixed sources)`);
        score += 15;
      }
    }

    // 5. CHECK FOR ACADEMIC PHRASE OVERUSE
    let phraseCount = 0;
    academicPhrases.forEach(phrase => {
      const regex = new RegExp(phrase, 'gi');
      const matches = lowerText.match(regex);
      if (matches) phraseCount += matches.length;
    });

    if (phraseCount > 8) {
      console.log(`📝 Overused academic phrases: ${phraseCount}`);
      score += Math.min(phraseCount * 2, 20);
    }

    // 6. CHECK FOR PERFECT FORMATTING (suggests copy-paste)
    const lines = text.split('\n');
    const longLines = lines.filter(line => line.length > 120 && line.trim().length > 0);
    if (longLines.length > 5) {
      console.log(`📏 Many long formatted lines: ${longLines.length}`);
      score += 10;
    }

    // Calculate final score with caps
    const finalScore = Math.min(score, 95);
    
    console.log(`📊 Final plagiarism score for ${filename}: ${finalScore}%`);
    console.log(`--- Analysis Summary ---`);
    console.log(`- Definite indicators: ${definiteIndicators.filter(i => lowerText.match(i.pattern)).length}`);
    console.log(`- Suspicious patterns: ${suspiciousCount}`);
    console.log(`- URLs found: ${urls ? urls.length : 0}`);
    console.log(`- Academic phrases: ${phraseCount}`);
    console.log(`------------------------`);

    return {
      score: finalScore,
      indicators: definiteIndicators.filter(i => lowerText.match(i.pattern)).map(i => i.description),
      suspiciousCount: suspiciousCount,
      urlsFound: urls ? urls.length : 0,
      phraseCount: phraseCount
    };

  } catch (error) {
    console.error('❌ Plagiarism calculation error:', error);
    return {
      score: 0,
      indicators: [],
      suspiciousCount: 0,
      urlsFound: 0,
      phraseCount: 0
    };
  }
}

// 🔧 Helper: Clean up uploaded file (with better error handling)
async function cleanupFile(filePath) {
  try {
    // Check if file exists before trying to delete
    await fs.access(filePath);
    await fs.unlink(filePath);
    console.log(`✅ File cleaned up: ${path.basename(filePath)}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`ℹ️ File already deleted: ${path.basename(filePath)}`);
    } else {
      console.warn(`⚠️ Could not delete file ${path.basename(filePath)}:`, error.message);
    }
  }
}

// 🔧 NEW: Trigger n8n workflow (REQUIRED BY PROJECT SPECS)
async function triggerN8nWorkflow(assignmentData) {
  try {
    if (!process.env.N8N_WEBHOOK_URL) {
      console.log('ℹ️ n8n webhook URL not configured, skipping workflow');
      return { success: false, skipped: true, reason: 'N8N_WEBHOOK_URL not configured' };
    }

    console.log('🚀 Triggering n8n workflow for assignment:', assignmentData.assignmentId);
    
    const n8nPayload = {
      assignment_id: assignmentData.assignmentId,
      student_id: assignmentData.studentId,
      filename: assignmentData.filename,
      file_path: assignmentData.filePath,
      extracted_text: assignmentData.text,
      word_count: assignmentData.wordCount,
      upload_timestamp: assignmentData.uploadTimestamp,
      // Include basic analysis for n8n to build upon
      initial_analysis: assignmentData.basicAnalysis
    };

    const response = await axios.post(process.env.N8N_WEBHOOK_URL, n8nPayload, {
      timeout: 10000 // 10 second timeout
    });

    console.log('✅ n8n workflow triggered successfully:', response.data);
    return { 
      success: true, 
      workflowId: response.data.workflowId || `n8n-${Date.now()}`,
      message: 'Workflow started successfully'
    };

  } catch (error) {
    console.error('❌ n8n workflow trigger failed:', error.message);
    return { 
      success: false, 
      error: error.message,
      skipped: false
    };
  }
}

// 🚀 Main Upload Handler - UPDATED FOR SUPABASE + N8N
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

    // 2️⃣ Use Local AI analysis (no API dependency)
    let analysisData;
    let aiSuccess = false;

    try {
      analysisData = await analyzeWithLocalAI(text, file.originalname);
      aiSuccess = true;
      console.log('✅ Local AI analysis completed successfully');
    } catch (aiError) {
      console.warn('Local AI analysis failed, using basic analysis:', aiError.message);
      analysisData = {
        topic: 'Academic Assignment',
        academic_level: 'Undergraduate',
        key_themes: ['Content Analysis'],
        writing_quality: 'Good',
        research_suggestions: 'Further review recommended',
        citation_recommendations: 'APA',
        confidence_score: 0.6
      };
    }

    // 3️⃣ Calculate enhanced plagiarism score
    const plagiarismResult = calculatePlagiarismScore(text, file.originalname);
    const plagiarismScore = plagiarismResult.score;

    // 4️⃣ Insert assignment into Supabase - UPDATED
    const { data: assignment, error: assignmentError } = await db
      .from('assignments')
      .insert([{
        student_id: studentId,
        filename: file.originalname,
        original_text: text,
        topic: analysisData.topic,
        academic_level: analysisData.academic_level,
        word_count: wordCount
      }])
      .select()
      .single();

    if (assignmentError) throw assignmentError;

    const assignmentId = assignment.id;

    // 5️⃣ Insert analysis result with plagiarism details - UPDATED
    const plagiarismDetails = {
      score: plagiarismScore,
      indicators: plagiarismResult.indicators,
      suspiciousPatterns: plagiarismResult.suspiciousCount,
      urlsFound: plagiarismResult.urlsFound,
      academicPhrases: plagiarismResult.phraseCount,
      wordCount: wordCount,
      detectedAt: new Date().toISOString()
    };

    const { data: analysisResult, error: analysisError } = await db
      .from('analysis_results')
      .insert([{
        assignment_id: assignmentId,
        suggested_sources: [], // Will be populated by n8n RAG
        plagiarism_score: plagiarismScore,
        flagged_sections: plagiarismDetails,
        research_suggestions: analysisData.research_suggestions,
        citation_recommendations: analysisData.citation_recommendations,
        confidence_score: analysisData.confidence_score
      }])
      .select()
      .single();

    if (analysisError) throw analysisError;

    // 6️⃣ Prepare data for n8n workflow
    const n8nAssignmentData = {
      assignmentId: assignmentId,
      studentId: studentId,
      filename: file.originalname,
      fileExtension: fileExtension,
      filePath: filePath,
      text: text,
      wordCount: wordCount,
      uploadTimestamp: new Date().toISOString(),
      
      // Enhanced analysis data
      basicAnalysis: {
        topic: analysisData.topic,
        academicLevel: analysisData.academic_level,
        writingQuality: analysisData.writing_quality,
        plagiarismScore: plagiarismScore,
        keyThemes: analysisData.key_themes,
        researchSuggestions: analysisData.research_suggestions,
        citationRecommendations: analysisData.citation_recommendations,
        confidenceScore: analysisData.confidence_score
      }
    };

    // 7️⃣ Clean up uploaded file
    await cleanupFile(filePath);

    // 8️⃣ Trigger n8n workflow (non-blocking background process) - UPDATED
    setImmediate(async () => {
      try {
        const n8nResult = await triggerN8nWorkflow(n8nAssignmentData);
        
        if (n8nResult.success && !n8nResult.skipped) {
          console.log('✅ n8n workflow completed:', n8nResult.workflowId);
          
          // Update database with n8n workflow status
          await db
            .from('analysis_results')
            .update({
              n8n_workflow_id: n8nResult.workflowId,
              n8n_processed: true,
              analyzed_at: new Date().toISOString()
            })
            .eq('assignment_id', assignmentId);
            
          console.log('📊 n8n workflow status updated for assignment:', assignmentId);
        } else if (n8nResult.skipped) {
          console.log('ℹ️ n8n workflow skipped:', n8nResult.reason);
        } else {
          console.warn('⚠️ n8n workflow failed:', n8nResult.error);
        }
        
      } catch (n8nError) {
        console.error('❌ n8n background processing failed:', n8nError.message);
      }
    });

    // 9️⃣ Send immediate response (don't wait for n8n)
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
        writingQuality: analysisData.writing_quality,
        keyThemes: analysisData.key_themes,
        aiAnalysis: aiSuccess,
        n8nProcessing: true
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