// backend/server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const db = require('./config/db');

const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const analysisRoutes = require('./routes/analysis');

dotenv.config();

const app = express();

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('uploads'));

// DeepSeek API integration function
async function callDeepSeekAPI(messages) {
    try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('DeepSeek API Error:', error.message);
        throw new Error(`Failed to get response from DeepSeek: ${error.message}`);
    }
}

// Health check route
app.get('/health', async (req, res) => {
    try {
        // Simple database check
        await db.execute('SELECT 1');
        
        // Check if DeepSeek API key is configured
        const apiKeyStatus = process.env.DEEPSEEK_API_KEY ? 'Configured' : 'Not configured';
        
        res.status(200).json({ 
            status: 'OK', 
            message: 'Server is running',
            database: 'Connected',
            deepseek_api: apiKeyStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'Error', 
            message: 'Server error',
            database: 'Disconnected',
            error: error.message 
        });
    }
});

// Test DeepSeek API route
app.post('/api/test-deepseek', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Message is required'
            });
        }

        if (!process.env.DEEPSEEK_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'DeepSeek API key not configured'
            });
        }

        const messages = [
            {
                role: "user",
                content: message
            }
        ];

        const response = await callDeepSeekAPI(messages);
        
        res.json({
            success: true,
            response: response,
            message: 'DeepSeek API test successful'
        });
        
    } catch (error) {
        console.error('Test DeepSeek Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Academic analysis using DeepSeek
app.post('/api/analyze-academic', async (req, res) => {
    try {
        const { text, analysisType = 'general' } = req.body;
        
        if (!text) {
            return res.status(400).json({
                success: false,
                message: 'Text content is required for analysis'
            });
        }

        if (!process.env.DEEPSEEK_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'DeepSeek API key not configured'
            });
        }

        // Different analysis prompts based on type
        const analysisPrompts = {
            'general': `Please analyze this academic text and provide:
1. Main arguments/thesis
2. Key supporting points
3. Writing quality assessment
4. Suggestions for improvement

Text: ${text}`,

            'grammar': `Please review this text for grammar, spelling, and punctuation errors. Provide corrections and explanations:

Text: ${text}`,

            'structure': `Analyze the structure and organization of this academic text. Comment on:
1. Introduction effectiveness
2. Paragraph coherence
3. Logical flow
4. Conclusion strength

Text: ${text}`,

            'citation': `Check this academic text for proper citation and referencing. Identify any potential issues and suggest improvements:

Text: ${text}`
        };

        const prompt = analysisPrompts[analysisType] || analysisPrompts['general'];
        
        const messages = [
            {
                role: "system",
                content: "You are an expert academic writing assistant. Provide detailed, constructive feedback to help improve academic writing."
            },
            {
                role: "user",
                content: prompt
            }
        ];

        const analysis = await callDeepSeekAPI(messages);
        
        res.json({
            success: true,
            analysis: analysis,
            type: analysisType,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Academic Analysis Error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// API Routes
app.use('/auth', authRoutes);
app.use('/upload', uploadRoutes);
app.use('/analysis', analysisRoutes);

// ✅ FIXED: 404 handler - Remove the '*' parameter
app.use((req, res) => {
    res.status(404).json({ 
        success: false,
        message: `Route not found: ${req.method} ${req.path}`
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    console.log(`🤖 DeepSeek API: ${process.env.DEEPSEEK_API_KEY ? 'Configured' : 'Not configured'}`);
});

module.exports = { callDeepSeekAPI };