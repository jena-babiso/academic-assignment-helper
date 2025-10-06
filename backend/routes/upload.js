// backend/routes/upload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middleware/authMiddleware');
const uploadController = require('../controllers/uploadController');

// Configure multer for file uploads with validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Create a safe filename with timestamp and original name
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeFilename = file.originalname.replace(/[^a-zA-Z0-9.\-]/g, '_');
    cb(null, uniqueSuffix + '-' + safeFilename);
  }
});

// File filter for security
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.pdf', '.docx'];
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only ${allowedTypes.join(', ')} files are allowed.`), false);
  }
};

// Configure multer with limits and validation
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only one file per request
  }
});

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Only one file allowed per upload.'
      });
    }
  } else if (error) {
    // Handle our custom file filter errors
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  next();
};

// Upload route with authentication and file processing
router.post(
  '/',
  authMiddleware, // Protect route with JWT
  upload.single('file'), // Handle single file upload
  handleMulterError, // Handle multer-specific errors
  uploadController.uploadAssignment // Process the uploaded file
);

// Optional: Route to get upload status (if you want progress tracking)
router.get('/status/:assignmentId', authMiddleware, async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId;
    const studentId = req.user.id;

    // Validate assignment ID
    if (!assignmentId || isNaN(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID'
      });
    }

    const db = require('../config/db');
    const [results] = await db.execute(
      `SELECT a.id, a.filename, a.uploaded_at, 
              r.analyzed_at, r.confidence_score
       FROM assignments a
       LEFT JOIN analysis_results r ON a.id = r.assignment_id
       WHERE a.id = ? AND a.student_id = ?`,
      [assignmentId, studentId]
    );

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    const assignment = results[0];
    const status = assignment.analyzed_at ? 'completed' : 'processing';

    res.json({
      success: true,
      data: {
        assignmentId: assignment.id,
        filename: assignment.filename,
        status: status,
        uploadedAt: assignment.uploaded_at,
        analyzedAt: assignment.analyzed_at,
        confidenceScore: assignment.confidence_score
      }
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check upload status'
    });
  }
});

// Optional: Route to delete an uploaded assignment
router.delete('/:assignmentId', authMiddleware, async (req, res) => {
  try {
    const assignmentId = req.params.assignmentId;
    const studentId = req.user.id;

    // Validate assignment ID
    if (!assignmentId || isNaN(assignmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID'
      });
    }

    const db = require('../config/db');
    
    // First, verify ownership and get filename
    const [assignments] = await db.execute(
      'SELECT filename FROM assignments WHERE id = ? AND student_id = ?',
      [assignmentId, studentId]
    );

    if (assignments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found or access denied'
      });
    }

    const filename = assignments[0].filename;
    const filePath = path.join(__dirname, '..', 'uploads', filename);

    // Delete from database (cascade should handle analysis_results if foreign key is set up)
    await db.execute('DELETE FROM assignments WHERE id = ?', [assignmentId]);

    // Delete the physical file
    const fs = require('fs').promises;
    try {
      await fs.unlink(filePath);
    } catch (fileError) {
      console.warn('Could not delete physical file:', fileError.message);
      // Continue even if file deletion fails
    }

    res.json({
      success: true,
      message: 'Assignment deleted successfully'
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment'
    });
  }
});

module.exports = router;