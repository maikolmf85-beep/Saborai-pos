require('dotenv').config({ path: 'c:/Users/matam/.gemini/antigravity-ide/scratch/saborai-pos/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUsers() {
  const { data, error } = await supabase.from('users').select('email');
  if (error) {
    console.error("Error fetching users:", error);
  } else {
    console.log("Registered users:", data);
  }
}

checkUsers();
