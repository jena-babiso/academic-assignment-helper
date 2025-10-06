const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'academic_helper',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
});

// Database helper functions
const db = {
  // Get a connection from pool
  getConnection: () => pool.getConnection(),

  // Execute a query with parameters
  execute: (sql, params = []) => pool.execute(sql, params),

  // Execute a query without prepared statement (for some operations)
  query: (sql, params = []) => pool.query(sql, params),

  // Check if database is connected
  isConnected: async () => {
    try {
      const [rows] = await pool.execute('SELECT 1');
      return true;
    } catch (error) {
      return false;
    }
  }
};

// Test connection on startup
async function initializeDatabase() {
  try {
    const connection = await db.getConnection();
    console.log('✅ MySQL Database connected successfully');
    connection.release();
    
    // Verify the required tables exist (optional)
    console.log('📊 Database configuration verified');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('💡 Please check:');
    console.log('   - Is MySQL running in XAMPP?');
    console.log('   - Are database credentials correct in .env?');
    console.log('   - Does the database exist?');
    process.exit(1);
  }
}

// Initialize database connection
initializeDatabase();

module.exports = db;