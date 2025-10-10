// backend/controllers/analysisController.js - UPDATED FOR SUPABASE

const db = require('../config/db'); // Now Supabase client

// Get all assignments uploaded by the logged-in student
exports.getAllAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;

    // Validate studentId
    if (!studentId) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID' 
      });
    }

    // UPDATED: Supabase query
    const { data: assignments, error } = await db
      .from('assignments')
      .select('id, filename, topic, academic_level, word_count, uploaded_at')
      .eq('student_id', studentId)
      .order('uploaded_at', { ascending: false });

    if (error) throw error;

    res.status(200).json({
      success: true,
      count: assignments ? assignments.length : 0,
      data: assignments || []
    });
  } catch (err) {
    console.error('Error fetching assignments:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch assignments' 
    });
  }
};

// Get a specific assignment's analysis result by ID
exports.getAnalysisById = async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const studentId = req.user.id;

    // Validate IDs
    if (!assignmentId) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid assignment ID' 
      });
    }

    // UPDATED: Supabase query with join
    const { data: results, error } = await db
      .from('assignments')
      .select(`
        id,
        filename,
        original_text,
        topic,
        academic_level,
        word_count,
        uploaded_at,
        analysis_results (
          suggested_sources,
          plagiarism_score,
          flagged_sections,
          research_suggestions,
          citation_recommendations,
          confidence_score,
          analyzed_at,
          n8n_workflow_id,
          n8n_processed
        )
      `)
      .eq('id', assignmentId)
      .eq('student_id', studentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return res.status(404).json({ 
          success: false,
          message: 'Analysis not found or access denied' 
        });
      }
      throw error;
    }

    // Handle case where analysis hasn't been processed yet
    if (!results.analysis_results || !results.analysis_results.analyzed_at) {
      return res.status(202).json({
        success: true,
        message: 'Analysis is still processing',
        data: {
          assignment_id: results.id,
          filename: results.filename,
          status: 'processing',
          n8n_processed: results.analysis_results?.n8n_processed || false
        }
      });
    }

    // Combine assignment and analysis data
    const analysis = {
      assignment_id: results.id,
      filename: results.filename,
      original_text: results.original_text,
      topic: results.topic,
      academic_level: results.academic_level,
      word_count: results.word_count,
      uploaded_at: results.uploaded_at,
      ...results.analysis_results
    };

    res.status(200).json({
      success: true,
      data: analysis
    });
  } catch (err) {
    console.error('Error fetching analysis:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch analysis' 
    });
  }
};

// Get analysis statistics for dashboard - FIXED VERSION
exports.getAnalysisStats = async (req, res) => {
  try {
    const studentId = req.user.id;

    // FIXED: Get assignments first, then use their IDs for analysis queries
    const { data: studentAssignments, error: assignmentsError } = await db
      .from('assignments')
      .select('id')
      .eq('student_id', studentId);

    if (assignmentsError) throw assignmentsError;

    const assignmentIds = studentAssignments ? studentAssignments.map(assignment => assignment.id) : [];

    // If no assignments, return empty stats
    if (assignmentIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          total_assignments: 0,
          analyzed_count: 0,
          avg_plagiarism_score: 0,
          best_confidence_score: 0
        }
      });
    }

    // FIXED: Get analysis data using assignment IDs
    const [
      analysisCount,
      plagiarismStats,
      confidenceStats
    ] = await Promise.all([
      // Analyzed assignments count - FIXED
      db
        .from('analysis_results')
        .select('id', { count: 'exact', head: true })
        .in('assignment_id', assignmentIds),
      
      // Average plagiarism score - FIXED
      db
        .from('analysis_results')
        .select('plagiarism_score')
        .in('assignment_id', assignmentIds)
        .not('plagiarism_score', 'is', null),
      
      // Best confidence score - FIXED
      db
        .from('analysis_results')
        .select('confidence_score')
        .in('assignment_id', assignmentIds)
        .not('confidence_score', 'is', null)
        .order('confidence_score', { ascending: false })
        .limit(1)
    ]);

    // Calculate statistics
    const totalAssignments = assignmentIds.length;
    const analyzedCount = analysisCount.count || 0;
    
    // Calculate average plagiarism score
    let avgPlagiarismScore = 0;
    if (plagiarismStats.data && plagiarismStats.data.length > 0) {
      const total = plagiarismStats.data.reduce((sum, item) => sum + item.plagiarism_score, 0);
      avgPlagiarismScore = total / plagiarismStats.data.length;
    }

    // Get best confidence score
    const bestConfidenceScore = confidenceStats.data && confidenceStats.data.length > 0 
      ? confidenceStats.data[0].confidence_score 
      : 0;

    const stats = {
      total_assignments: totalAssignments,
      analyzed_count: analyzedCount,
      avg_plagiarism_score: parseFloat(avgPlagiarismScore.toFixed(2)),
      best_confidence_score: parseFloat(bestConfidenceScore.toFixed(2))
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch statistics' 
    });
  }
};

// NEW: Search academic sources using RAG (Required by project specs)
exports.searchSources = async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ 
        success: false,
        message: 'Query parameter is required' 
      });
    }

    // UPDATED: Search academic sources from Supabase
    const { data: sources, error } = await db
      .from('academic_sources')
      .select('id, title, authors, publication_year, abstract, source_type')
      .or(`title.ilike.%${query}%,abstract.ilike.%${query}%,authors.ilike.%${query}%`)
      .limit(10);

    if (error) throw error;

    res.status(200).json({
      success: true,
      count: sources ? sources.length : 0,
      query: query,
      data: sources || []
    });
  } catch (err) {
    console.error('Error searching sources:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to search academic sources' 
    });
  }
};

// NEW: Get all analysis results with pagination
exports.getAllAnalyses = async (req, res) => {
  try {
    const studentId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // UPDATED: Get analyses with pagination
    const { data: analyses, error, count } = await db
      .from('assignments')
      .select(`
        id,
        filename,
        topic,
        academic_level,
        word_count,
        uploaded_at,
        analysis_results (
          plagiarism_score,
          confidence_score,
          analyzed_at
        )
      `, { count: 'exact' })
      .eq('student_id', studentId)
      .order('uploaded_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.status(200).json({
      success: true,
      data: analyses || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching analyses:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch analyses' 
    });
  }
};