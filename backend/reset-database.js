// reset-database.js
const mysql = require('mysql2/promise');
require('dotenv').config();

async function resetDatabase() {
  let connection;
  try {
    // Connect without specifying database
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });

    console.log('✅ Connected to MySQL server');

    // Drop existing database
    await connection.execute('DROP DATABASE IF EXISTS academic_helper');
    console.log('🗑️  Old database dropped');

    // Create fresh database
    await connection.execute('CREATE DATABASE academic_helper');
    console.log('✅ New database created');

    // Use the database
    await connection.execute('USE academic_helper');
    console.log('✅ Using academic_helper database');

    // Create tables with exact schema from your project
    const tables = [
      `CREATE TABLE students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        student_id VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        filename TEXT NOT NULL,
        original_text LONGTEXT NOT NULL,
        topic TEXT,
        academic_level VARCHAR(50),
        word_count INT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE analysis_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        assignment_id INT NOT NULL,
        suggested_sources JSON,
        plagiarism_score FLOAT DEFAULT 0,
        flagged_sections JSON,
        research_suggestions TEXT,
        citation_recommendations TEXT,
        confidence_score FLOAT DEFAULT 0,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
      )`,

      `CREATE TABLE academic_sources (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT,
        publication_year INT,
        abstract TEXT,
        full_text LONGTEXT,
        source_type VARCHAR(50),
        embedding JSON
      )`
    ];

    for (const tableSql of tables) {
      await connection.execute(tableSql);
      console.log(`✅ Table created: ${tableSql.split('(')[0].replace('CREATE TABLE', '').trim()}`);
    }

    // Insert sample academic sources
    const sampleSources = [
      ['Introduction to Machine Learning', 'John Smith, Sarah Johnson', 2020, 'Comprehensive introduction to machine learning concepts and algorithms.', 'textbook', NULL],
      ['Deep Learning Research Review', 'Michael Brown et al.', 2022, 'Recent advances in deep learning architectures and applications.', 'paper', NULL],
      ['Natural Language Processing Fundamentals', 'Emily Davis, Robert Wilson', 2021, 'Fundamental concepts and techniques in natural language processing.', 'textbook', NULL],
      ['Computer Vision Applications', 'Jennifer Lee, David Chen', 2023, 'Practical applications of computer vision in various industries.', 'paper', NULL],
      ['Data Science Methodology', 'Professor Williams', 2019, 'Systematic approach to data science projects and analysis.', 'textbook', NULL]
    ];

    for (const source of sampleSources) {
      await connection.execute(
        'INSERT INTO academic_sources (title, authors, publication_year, abstract, source_type, embedding) VALUES (?, ?, ?, ?, ?, ?)',
        source
      );
    }
    console.log('✅ Sample academic sources inserted');

    console.log('\n🎉 DATABASE RESET COMPLETED SUCCESSFULLY!');
    console.log('📊 Fresh database with 4 tables created:');
    console.log('   - students');
    console.log('   - assignments');
    console.log('   - analysis_results');
    console.log('   - academic_sources');
    console.log('   - 5 sample academic sources inserted');

  } catch (error) {
    console.error('❌ Database reset failed:', error.message);
    console.log('💡 Make sure MySQL is running in XAMPP');
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Confirm before reset
console.log('🚨 WARNING: This will DELETE ALL DATA in academic_helper database!');
console.log('All students, assignments, and analysis results will be lost forever!');
console.log('\nType "RESET" to confirm:');

// Simple confirmation
process.stdin.on('data', (data) => {
  const input = data.toString().trim();
  if (input === 'RESET') {
    resetDatabase();
  } else {
    console.log('Reset cancelled.');
    process.exit();
  }
});