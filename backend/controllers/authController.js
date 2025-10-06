// backend/controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Email validation helper
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Password strength validation
const isStrongPassword = (password) => {
  return password.length >= 8;
};

exports.register = async (req, res) => {
  const { full_name, email, password, student_id } = req.body;

  // Enhanced validation
  if (!full_name || !email || !password || !student_id) {
    return res.status(400).json({ 
      success: false,
      message: "All fields are required" 
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ 
      success: false,
      message: "Please provide a valid email address" 
    });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({ 
      success: false,
      message: "Password must be at least 8 characters long" 
    });
  }

  try {
    // Check if email already exists
    const [existingEmail] = await db.execute(
      "SELECT id FROM students WHERE email = ?", 
      [email]
    );
    
    if (existingEmail.length > 0) {
      return res.status(409).json({ 
        success: false,
        message: "Email already registered" 
      });
    }

    // Check if student_id already exists
    const [existingStudentId] = await db.execute(
      "SELECT id FROM students WHERE student_id = ?", 
      [student_id]
    );
    
    if (existingStudentId.length > 0) {
      return res.status(409).json({ 
        success: false,
        message: "Student ID already registered" 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12); // Increased salt rounds

    const [result] = await db.execute(
      "INSERT INTO students (full_name, email, password_hash, student_id) VALUES (?, ?, ?, ?)",
      [full_name.trim(), email.toLowerCase().trim(), hashedPassword, student_id.trim()]
    );

    // Generate token immediately after registration
    const token = jwt.sign(
      { 
        id: result.insertId, 
        email: email,
        student_id: student_id
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "7d" } // Longer expiry for better UX
    );

    res.status(201).json({ 
      success: true,
      message: "Student registered successfully",
      token: token,
      user: {
        id: result.insertId,
        full_name: full_name,
        email: email,
        student_id: student_id
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ 
      success: false,
      message: "Registration failed. Please try again." 
    });
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  // Input validation
  if (!email || !password) {
    return res.status(400).json({ 
      success: false,
      message: "Email and password are required" 
    });
  }

  try {
    const [users] = await db.execute(
      "SELECT id, full_name, email, student_id, password_hash FROM students WHERE email = ?", 
      [email.toLowerCase().trim()]
    );
    
    const user = users[0];

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        message: "Invalid email or password" 
      });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        student_id: user.student_id
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "7d" }
    );

    res.json({ 
      success: true,
      message: "Login successful",
      token: token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        student_id: user.student_id
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ 
      success: false,
      message: "Login failed. Please try again." 
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const [users] = await db.execute(
      "SELECT id, full_name, email, student_id, created_at FROM students WHERE id = ?",
      [req.user.id]
    );
    
    const user = users[0];
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user profile"
    });
  }
};