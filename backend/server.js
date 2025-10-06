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

// Health check route
app.get('/health', async (req, res) => {
    try {
        // Simple database check
        await db.execute('SELECT 1');
        res.status(200).json({ 
            status: 'OK', 
            message: 'Server is running',
            database: 'Connected',
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
});