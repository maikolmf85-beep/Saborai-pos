import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  console.log("Testing Supabase Connection...");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if(!url || !key) {
    console.error("Missing credentials in .env");
    return;
  }
  const supabase = createClient(url, key);
  
  try {
    console.log("1. Fetching users...");
    const { data: users, error: selectErr } = await supabase.from('users').select('*').limit(1);
    if(selectErr) {
       console.error("Select error:", selectErr);
    } else {
       console.log("Select success! Found users:", users.length);
    }

    console.log("2. Testing bcrypt...");
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash("test1234", salt);
    console.log("Bcrypt success:", hash.substring(0, 10) + "...");

    console.log("3. Testing insert user...");
    const testEmail = "test_" + Date.now() + "@test.com";
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        email: testEmail,
        name: "Test User",
        phone: "123",
        restaurant_name: "Test Rest",
        password_hash: hash,
      })
      .select()
      .single();

    if (userError) {
      console.error("Insert error:", userError);
    } else {
      console.log("Insert success! User ID:", newUser.id);
      
      // cleanup
      await supabase.from('users').delete().eq('id', newUser.id);
      console.log("Cleanup success.");
    }

  } catch (e) {
    console.error("Unexpected error:", e);
  }
}
test();
