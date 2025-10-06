// backend/setup-tables.js
const db = require('./config/db');

async function setupTables() {
  try {
    console.log('🚀 Starting table creation...');

    // Create students table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        student_id VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ students table created');

    // Create assignments table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        student_id INT NOT NULL,
        filename TEXT NOT NULL,
        original_text LONGTEXT NOT NULL,
        topic TEXT,
        academic_level VARCHAR(50),
        word_count INT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ assignments table created');

    // Create analysis_results table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS analysis_results (
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
      )
    `);
    console.log('✅ analysis_results table created');

    // Create academic_sources table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS academic_sources (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT,
        publication_year INT,
        abstract TEXT,
        full_text LONGTEXT,
        source_type VARCHAR(50),
        embedding JSON
      )
    `);
    console.log('✅ academic_sources table created');

    // Insert sample academic sources
    const sampleSources = [
      ['Introduction to Machine Learning', 'John Smith, Sarah Johnson', 2020, 'Comprehensive introduction to machine learning concepts and algorithms.', 'textbook', NULL],
      ['Deep Learning Research Review', 'Michael Brown et al.', 2022, 'Recent advances in deep learning architectures and applications.', 'paper', NULL],
      ['Natural Language Processing Fundamentals', 'Emily Davis, Robert Wilson', 2021, 'Fundamental concepts and techniques in natural language processing.', 'textbook', NULL],
      ['Computer Vision Applications', 'Jennifer Lee, David Chen', 2023, 'Practical applications of computer vision in various industries.', 'paper', NULL],
      ['Data Science Methodology', 'Professor Williams', 2019, 'Systematic approach to data science projects and analysis.', 'textbook', NULL]
    ];

    for (const source of sampleSources) {
      await db.execute(
        'INSERT IGNORE INTO academic_sources (title, authors, publication_year, abstract, source_type, embedding) VALUES (?, ?, ?, ?, ?, ?)',
        source
      );
    }
    console.log('✅ 5 sample academic sources inserted');

    console.log('\n🎉 ALL TABLES CREATED SUCCESSFULLY!');
    
    // Verify tables
    const [tables] = await db.execute('SHOW TABLES');
    console.log('\n📊 Tables in database:');
    tables.forEach(table => {
      console.log(`   📁 ${Object.values(table)[0]}`);
    });

  } catch (error) {
    console.error('❌ Table creation failed:', error.message);
  } finally {
    process.exit();
  }
}

setupTables();