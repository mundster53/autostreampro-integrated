// netlify/functions/_supabase.js
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  // This helps you see the problem quickly in Netlify function logs
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

module.exports = { supabase };
