// backend/routes/analysis.js
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET all assignments for logged-in student
router.get('/assignments', authMiddleware, async (req, res) => {
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
});

// GET analysis result by assignment ID (with ownership check)
router.get('/:id', authMiddleware, async (req, res) => {
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

    // Parse JSON fields if they exist
    if (analysis.suggested_sources) {
      try {
        analysis.suggested_sources = JSON.parse(analysis.suggested_sources);
      } catch (e) {
        console.warn('Failed to parse suggested_sources JSON');
      }
    }

    if (analysis.flagged_sections) {
      try {
        analysis.flagged_sections = JSON.parse(analysis.flagged_sections);
      } catch (e) {
        console.warn('Failed to parse flagged_sections JSON');
      }
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
});

// GET analysis statistics for dashboard
router.get('/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    const studentId = req.user.id;

    const [stats] = await db.execute(
      `SELECT 
        COUNT(*) as total_assignments,
        AVG(r.plagiarism_score) as avg_plagiarism_score,
        MAX(r.confidence_score) as best_confidence_score,
        COUNT(r.id) as analyzed_count,
        SUM(CASE WHEN r.plagiarism_score > 50 THEN 1 ELSE 0 END) as high_plagiarism_count
       FROM assignments a
       LEFT JOIN analysis_results r ON a.id = r.assignment_id
       WHERE a.student_id = ?`,
      [studentId]
    );

    const [recentAssignments] = await db.execute(
      `SELECT a.id, a.filename, a.uploaded_at, r.plagiarism_score, r.confidence_score
       FROM assignments a
       LEFT JOIN analysis_results r ON a.id = r.assignment_id
       WHERE a.student_id = ?
       ORDER BY a.uploaded_at DESC
       LIMIT 5`,
      [studentId]
    );

    res.status(200).json({
      success: true,
      data: {
        ...stats[0],
        recent_assignments: recentAssignments
      }
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch statistics' 
    });
  }
});

module.exports = router;