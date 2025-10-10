// backend/controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db'); // This now exports Supabase client

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

  // Enhanced validation (unchanged)
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
    // Check if email already exists - UPDATED for Supabase
    const { data: existingEmail, error: emailError } = await db
      .from('students')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (emailError && emailError.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw emailError;
    }

    if (existingEmail) {
      return res.status(409).json({ 
        success: false,
        message: "Email already registered" 
      });
    }

    // Check if student_id already exists - UPDATED for Supabase
    const { data: existingStudentId, error: studentIdError } = await db
      .from('students')
      .select('id')
      .eq('student_id', student_id.trim())
      .single();

    if (studentIdError && studentIdError.code !== 'PGRST116') {
      throw studentIdError;
    }

    if (existingStudentId) {
      return res.status(409).json({ 
        success: false,
        message: "Student ID already registered" 
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Insert new user - UPDATED for Supabase
    const { data: newUser, error: insertError } = await db
      .from('students')
      .insert([{
        full_name: full_name.trim(),
        email: email.toLowerCase().trim(),
        password_hash: hashedPassword,
        student_id: student_id.trim()
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    // Generate token immediately after registration
    const token = jwt.sign(
      { 
        id: newUser.id, 
        email: newUser.email,
        student_id: newUser.student_id
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: "7d" }
    );

    res.status(201).json({ 
      success: true,
      message: "Student registered successfully",
      token: token,
      user: {
        id: newUser.id,
        full_name: newUser.full_name,
        email: newUser.email,
        student_id: newUser.student_id
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
    // Get user - UPDATED for Supabase
    const { data: user, error } = await db
      .from('students')
      .select('id, full_name, email, student_id, password_hash')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // No user found
        return res.status(401).json({ 
          success: false,
          message: "Invalid email or password" 
        });
      }
      throw error;
    }

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
    // Get user profile - UPDATED for Supabase
    const { data: user, error } = await db
      .from('students')
      .select('id, full_name, email, student_id, created_at')
      .eq('id', req.user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
      throw error;
    }

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