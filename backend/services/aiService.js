// backend/services/aiService.js
const { OpenAI } = require('openai');
require('dotenv').config();

// Validate API key on startup
if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is missing from environment variables');
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000, // 30 second timeout
  maxRetries: 2,
});

// Constants for configuration
const EMBEDDING_MODEL = 'text-embedding-ada-002';
const CHAT_MODEL = 'gpt-4'; // or 'gpt-3.5-turbo' for cost savings

// Convert text to embedding with error handling and optimization
async function getEmbedding(text) {
  try {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty for embedding generation');
    }

    // Truncate very long texts to avoid token limits
    const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncatedText.trim(),
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('No embedding data received from OpenAI');
    }

    return response.data[0].embedding;
  } catch (error) {
    console.error('Embedding generation error:', error.message);
    
    if (error.code === 'insufficient_quota') {
      throw new Error('OpenAI API quota exceeded. Please check your billing.');
    } else if (error.code === 'invalid_api_key') {
      throw new Error('Invalid OpenAI API key. Please check your configuration.');
    } else if (error.code === 'rate_limit_exceeded') {
      throw new Error('OpenAI rate limit exceeded. Please try again shortly.');
    }
    
    throw new Error(`Embedding generation failed: ${error.message}`);
  }
}

// Optimized cosine similarity between 2 vectors
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    throw new Error('Vectors must be non-empty and of same length');
  }

  if (vecA.length === 0 || vecB.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Batch cosine similarity for multiple sources
function batchCosineSimilarity(assignmentEmbedding, sourceEmbeddings) {
  return sourceEmbeddings.map(source => ({
    ...source,
    similarity: cosineSimilarity(assignmentEmbedding, source.embedding)
  }));
}

// Enhanced GPT analysis with structured output
async function generateSummary(text, sources) {
  try {
    if (!text || text.trim().length < 50) {
      throw new Error('Text too short for meaningful analysis');
    }

    // Truncate text to manage token usage
    const analysisText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;

    const systemPrompt = `You are an academic expert analyzing student assignments. Provide a structured JSON response with the following fields:
- "topic": main topic of the assignment
- "academic_level": "High School", "Undergraduate", "Master", or "PhD"
- "key_themes": array of 3-5 main themes
- "research_suggestions": specific suggestions for improvement
- "citation_recommendations": recommended citation styles
- "flagged_sections": array of potentially problematic sections (empty if none)
- "confidence_score": your confidence in this analysis (0-1)

Be objective, constructive, and focus on academic improvement.`;

    const userPrompt = `
ASSIGNMENT TEXT FOR ANALYSIS:
"""${analysisText}"""

RELEVANT ACADEMIC SOURCES FOUND:
${sources.length > 0 
  ? sources.slice(0, 3).map((s, i) => 
      `Source ${i + 1}: "${s.title}" by ${s.authors}\nRelevance: ${(s.similarity * 100).toFixed(1)}%`
    ).join('\n\n')
  : 'No highly relevant sources found.'
}

Please analyze this assignment and provide feedback in the specified JSON format.`;

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more consistent results
      max_tokens: 1500,
      response_format: { type: "json_object" } // Force JSON response
    });

    const content = completion.choices[0].message.content;
    
    // Parse and validate the JSON response
    try {
      const analysis = JSON.parse(content);
      
      // Validate required fields
      const requiredFields = ['topic', 'academic_level', 'key_themes', 'research_suggestions'];
      for (const field of requiredFields) {
        if (!analysis[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }
      
      return analysis;
    } catch (parseError) {
      console.warn('AI returned invalid JSON, using fallback analysis');
      return createFallbackAnalysis(text);
    }

  } catch (error) {
    console.error('AI analysis error:', error.message);
    
    if (error.code === 'insufficient_quota' || error.code === 'billing_not_active') {
      throw new Error('OpenAI service unavailable. Please check your API account.');
    }
    
    // Return fallback analysis on error
    return createFallbackAnalysis(text);
  }
}

// Fallback analysis when AI service fails
function createFallbackAnalysis(text) {
  const wordCount = text.split(/\s+/).length;
  
  return {
    topic: 'General Academic Assignment',
    academic_level: wordCount > 2000 ? 'Undergraduate' : 'High School',
    key_themes: ['Academic writing', 'Research content', 'Critical analysis'],
    research_suggestions: 'Consider expanding your research with additional academic sources and providing more detailed analysis of key concepts.',
    citation_recommendations: 'APA, MLA, Chicago',
    flagged_sections: [],
    confidence_score: 0.5
  };
}

// Optional: Cost estimation helper
function estimateCost(text, model = CHAT_MODEL) {
  const tokens = Math.ceil(text.length / 4); // Rough estimate
  const costPerToken = model === 'gpt-4' ? 0.03 : 0.002; // Rough costs per 1K tokens
  
  return (tokens / 1000) * costPerToken;
}

module.exports = {
  getEmbedding,
  cosineSimilarity,
  batchCosineSimilarity,
  generateSummary,
  estimateCost
};