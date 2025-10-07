// backend/routes/analysis.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');
const { callDeepSeekAPI } = require('../server'); // Import from server.js

// Remove OpenAI and add DeepSeek analysis function
async function analyzeWithDeepSeek(text, analysisType = 'academic') {
    const analysisPrompts = {
        'academic': `Please analyze this academic assignment and provide detailed feedback on:
1. Thesis clarity and strength
2. Argument structure and logical flow
3. Evidence and support quality
4. Writing style and academic tone
5. Grammar and mechanics
6. Overall coherence and effectiveness

Provide constructive suggestions for improvement.

Assignment Text: ${text}`,

        'plagiarism': `Analyze this text for potential plagiarism issues. Look for:
1. Uncited sources or references
2. Suspicious phrasing that might indicate copying
3. Inconsistent writing style
4. Areas that need proper citation

Text: ${text}`,

        'research': `Evaluate the research quality of this academic work:
1. Source credibility and relevance
2. Depth of research
3. Integration of evidence
4. Citation quality
5. Suggestions for additional sources

Text: ${text}`
    };

    const prompt = analysisPrompts[analysisType] || analysisPrompts['academic'];
    
    const messages = [
        {
            role: "system",
            content: "You are an expert academic writing analyst. Provide detailed, constructive feedback to help students improve their academic writing, research, and citation skills."
        },
        {
            role: "user",
            content: prompt
        }
    ];

    return await callDeepSeekAPI(messages);
}

// POST - Analyze assignment with DeepSeek
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        const { assignmentId, analysisType = 'academic' } = req.body;
        const studentId = req.user.id;

        // Validate input
        if (!assignmentId) {
            return res.status(400).json({ 
                success: false,
                message: 'Assignment ID is required' 
            });
        }

        // Get assignment text with ownership check
        const [assignments] = await db.execute(
            `SELECT id, original_text, filename 
             FROM assignments 
             WHERE id = ? AND student_id = ?`,
            [assignmentId, studentId]
        );

        if (assignments.length === 0) {
            return res.status(404).json({ 
                success: false,
                message: 'Assignment not found or access denied' 
            });
        }

        const assignment = assignments[0];
        
        if (!assignment.original_text) {
            return res.status(400).json({ 
                success: false,
                message: 'No text content available for analysis' 
            });
        }

        // Check if DeepSeek API key is available
        if (!process.env.DEEPSEEK_API_KEY) {
            return res.status(500).json({ 
                success: false,
                message: 'AI analysis service is not configured' 
            });
        }

        // Analyze with DeepSeek
        const analysisResult = await analyzeWithDeepSeek(assignment.original_text, analysisType);

        // Save analysis results to database
        const [result] = await db.execute(
            `INSERT INTO analysis_results 
             (assignment_id, analysis_type, analysis_result, analyzed_at) 
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE 
             analysis_result = VALUES(analysis_result), 
             analyzed_at = NOW()`,
            [assignmentId, analysisType, analysisResult]
        );

        res.status(200).json({
            success: true,
            message: 'Analysis completed successfully',
            data: {
                assignmentId: assignmentId,
                analysisType: analysisType,
                analysis: analysisResult,
                analyzedAt: new Date().toISOString()
            }
        });

    } catch (err) {
        console.error('DeepSeek Analysis Error:', err);
        res.status(500).json({ 
            success: false,
            message: 'Failed to analyze assignment: ' + err.message 
        });
    }
});

// GET all assignments for logged-in student (keep this as is)
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

// GET analysis result by assignment ID (with ownership check) - UPDATED
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
                    r.analysis_type, r.analysis_result, r.analyzed_at
             FROM assignments a
             LEFT JOIN analysis_results r ON a.id = r.assignment_id
             WHERE a.id = ? AND a.student_id = ?
             ORDER BY r.analyzed_at DESC
             LIMIT 1`,
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
                message: 'Analysis is not yet processed',
                data: {
                    assignment_id: analysis.assignment_id,
                    filename: analysis.filename,
                    status: 'pending'
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
});

// GET analysis statistics for dashboard (keep this as is)
router.get('/stats/dashboard', authMiddleware, async (req, res) => {
    try {
        const studentId = req.user.id;

        const [stats] = await db.execute(
            `SELECT 
                COUNT(*) as total_assignments,
                COUNT(r.id) as analyzed_count,
                AVG(LENGTH(r.analysis_result)) as avg_analysis_length
             FROM assignments a
             LEFT JOIN analysis_results r ON a.id = r.assignment_id
             WHERE a.student_id = ?`,
            [studentId]
        );

        const [recentAssignments] = await db.execute(
            `SELECT a.id, a.filename, a.uploaded_at, r.analyzed_at
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