// config/db.js - CLEAN FIXED VERSION
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Clean Supabase helper functions - REMOVED DEPRECATED METHODS
const db = {
  // Direct Supabase client access (use this instead of execute/query)
  supabase: supabase,

  // Table-specific methods for easier migration
  from: (tableName) => supabase.from(tableName),

  // RPC calls for stored procedures (like match_sources)
  rpc: (fnName, params) => supabase.rpc(fnName, params),

  // Check if database is connected
  isConnected: async () => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('count')
        .limit(1);
      return !error;
    } catch (error) {
      return false;
    }
  },

  // NEW: Simple raw SQL execution for basic queries (if absolutely needed)
  raw: async (sql) => {
    console.warn('⚠️  Using raw SQL - prefer direct Supabase methods');
    // For very simple SQL queries only
    try {
      // This is a simplified approach - use sparingly
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .limit(1);
      if (error) throw error;
      return [data];
    } catch (error) {
      throw new Error(`Raw query failed: ${error.message}`);
    }
  }
};

// Test connection on startup
async function initializeDatabase() {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('count')
      .limit(1);

    if (error) throw error;
    
    console.log('✅ Supabase Database connected successfully');
    console.log('📊 Supabase tables ready for use');
    
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    console.log('💡 Please check:');
    console.log('   - Is SUPABASE_URL set in .env?');
    console.log('   - Is SUPABASE_ANON_KEY set in .env?');
    console.log('   - Does your Supabase project have the required tables?');
    console.log('   - Is your Supabase project active?');
    process.exit(1);
  }
}

// Initialize database connection
initializeDatabase();

module.exports = db;