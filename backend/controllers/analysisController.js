// backend/controllers/analysisController.js

const db = require('../config/db');

// Get all assignments uploaded by the logged-in student
exports.getAllAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;

    // Validate studentId
    if (!studentId || isNaN(studentId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid user ID' 
      });
    }

    const [assignments] = await db.execute(
      `SELECT id, filename, topic, academic_level, word_count, uploaded_at
       FROM assignments
       WHERE student_id = ?
       ORDER BY uploaded_at DESC`,
      [studentId]
    );

    res.status(200).json({
      success: true,
      count: assignments.length,
      data: assignments
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
    if (!assignmentId || isNaN(assignmentId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid assignment ID' 
      });
    }

    const [results] = await db.execute(
      `SELECT a.id AS assignment_id, a.filename, a.original_text, a.topic, 
              a.academic_level, a.word_count, a.uploaded_at,
              r.suggested_sources, r.plagiarism_score, r.flagged_sections,
              r.research_suggestions, r.citation_recommendations, r.confidence_score,
              r.analyzed_at
       FROM assignments a
       LEFT JOIN analysis_results r ON a.id = r.assignment_id
       WHERE a.id = ? AND a.student_id = ?`,
      [assignmentId, studentId]
    );

    if (results.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'Analysis not found or access denied' 
      });
    }

    const analysis = results[0];
    
    // Handle case where analysis hasn't been processed yet
    if (!analysis.analyzed_at) {
      return res.status(202).json({
        success: true,
        message: 'Analysis is still processing',
        data: {
          assignment_id: analysis.assignment_id,
          filename: analysis.filename,
          status: 'processing'
        }
      });
    }

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

// Get analysis statistics for dashboard
exports.getAnalysisStats = async (req, res) => {
  try {
    const studentId = req.user.id;

    const [stats] = await db.execute(
      `SELECT 
        COUNT(*) as total_assignments,
        AVG(r.plagiarism_score) as avg_plagiarism_score,
        MAX(r.confidence_score) as best_confidence_score,
        COUNT(r.id) as analyzed_count
       FROM assignments a
       LEFT JOIN analysis_results r ON a.id = r.assignment_id
       WHERE a.student_id = ?`,
      [studentId]
    );

    res.status(200).json({
      success: true,
      data: stats[0]
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch statistics' 
    });
  }
};