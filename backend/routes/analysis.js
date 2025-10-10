// backend/routes/analysis.js - COMPLETE FIXED VERSION
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Supabase client
const authMiddleware = require('../middleware/authMiddleware');
const { callDeepSeekAPI } = require('../server');

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

        if (!assignmentId) {
            return res.status(400).json({ 
                success: false,
                message: 'Assignment ID is required' 
            });
        }

        // Get assignment text with ownership check
        const { data: assignment, error } = await db
            .from('assignments')
            .select('id, original_text, filename')
            .eq('id', assignmentId)
            .eq('student_id', studentId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    success: false,
                    message: 'Assignment not found or access denied' 
                });
            }
            throw error;
        }
        
        if (!assignment.original_text) {
            return res.status(400).json({ 
                success: false,
                message: 'No text content available for analysis' 
            });
        }

        if (!process.env.DEEPSEEK_API_KEY) {
            return res.status(500).json({ 
                success: false,
                message: 'AI analysis service is not configured' 
            });
        }

        // Analyze with DeepSeek
        const analysisResult = await analyzeWithDeepSeek(assignment.original_text, analysisType);

        // Save analysis results to Supabase
        const { data: result, error: insertError } = await db
            .from('analysis_results')
            .upsert({
                assignment_id: assignmentId,
                analysis_type: analysisType,
                analysis_result: analysisResult,
                analyzed_at: new Date().toISOString()
            })
            .select();

        if (insertError) throw insertError;

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

// ========== DIRECT ROUTES (NO CONTROLLER NEEDED) ==========

// GET all assignments for logged-in student - FIXED
router.get('/assignments', authMiddleware, async (req, res) => {
    try {
        const studentId = req.user.id;

        if (!studentId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID'
            });
        }

        // Direct Supabase query
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
});

// GET analysis result by assignment ID - FIXED
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const assignmentId = req.params.id;
        const studentId = req.user.id;

        if (!assignmentId) {
            return res.status(400).json({
                success: false,
                message: 'Invalid assignment ID'
            });
        }

        // Direct Supabase query with join
        const { data: result, error } = await db
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
                    n8n_processed
                )
            `)
            .eq('id', assignmentId)
            .eq('student_id', studentId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    success: false,
                    message: 'Analysis not found or access denied'
                });
            }
            throw error;
        }

        // Handle case where analysis hasn't been processed yet
        if (!result.analysis_results || !result.analysis_results.analyzed_at) {
            return res.status(202).json({
                success: true,
                message: 'Analysis is still processing',
                data: {
                    assignment_id: result.id,
                    filename: result.filename,
                    status: 'processing',
                    n8n_processed: result.analysis_results?.n8n_processed || false
                }
            });
        }

        // Combine assignment and analysis data
        const analysis = {
            assignment_id: result.id,
            filename: result.filename,
            original_text: result.original_text,
            topic: result.topic,
            academic_level: result.academic_level,
            word_count: result.word_count,
            uploaded_at: result.uploaded_at,
            ...result.analysis_results
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
});

// GET analysis statistics for dashboard - FIXED
router.get('/stats/dashboard', authMiddleware, async (req, res) => {
    try {
        const studentId = req.user.id;

        // Multiple Supabase queries for stats
        const [
            assignmentsCount,
            analysisCount,
            plagiarismStats,
            confidenceStats
        ] = await Promise.all([
            // Total assignments count
            db
                .from('assignments')
                .select('id', { count: 'exact', head: true })
                .eq('student_id', studentId),

            // Analyzed assignments count
            db
                .from('analysis_results')
                .select('id', { count: 'exact', head: true })
                .eq('assignments.student_id', studentId),

            // Average plagiarism score
            db
                .from('analysis_results')
                .select('plagiarism_score')
                .eq('assignments.student_id', studentId)
                .not('plagiarism_score', 'is', null),

            // Best confidence score
            db
                .from('analysis_results')
                .select('confidence_score')
                .eq('assignments.student_id', studentId)
                .not('confidence_score', 'is', null)
                .order('confidence_score', { ascending: false })
                .limit(1)
        ]);

        // Calculate statistics
        const totalAssignments = assignmentsCount.count || 0;
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
});

// ========== NEW ROUTES ==========

// Search academic sources using RAG
router.get('/sources/search', authMiddleware, async (req, res) => {
    try {
        const { query } = req.query;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Query parameter is required'
            });
        }

        // Search academic sources from Supabase
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
});

// GET all analyses with pagination
router.get('/', authMiddleware, async (req, res) => {
    try {
        const studentId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Get analyses with pagination
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
});

// GET analysis statistics for dashboard (alternative version)
router.get('/stats/summary', authMiddleware, async (req, res) => {
    try {
        const studentId = req.user.id;

        // Get stats using multiple Supabase queries
        const [
            assignmentsCount,
            analysisCount,
            recentAssignments
        ] = await Promise.all([
            // Total assignments count
            db
                .from('assignments')
                .select('id', { count: 'exact', head: true })
                .eq('student_id', studentId),
            
            // Analyzed assignments count
            db
                .from('analysis_results')
                .select('id', { count: 'exact', head: true })
                .eq('assignments.student_id', studentId),
            
            // Recent assignments
            db
                .from('assignments')
                .select('id, filename, uploaded_at, analysis_results (analyzed_at)')
                .eq('student_id', studentId)
                .order('uploaded_at', { ascending: false })
                .limit(5)
        ]);

        const stats = {
            total_assignments: assignmentsCount.count || 0,
            analyzed_count: analysisCount.count || 0,
            recent_assignments: recentAssignments.data || []
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
});

module.exports = router;