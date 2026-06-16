const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    // Update user to ADMIN
    const updateResult = await client.query(
      'UPDATE users SET user_type = $1 WHERE email = $2 RETURNING id, email, user_type',
      ['ADMIN', 'admin@strongauto.com']
    );
    console.log('Update result:', updateResult.rows);
    
    // Verify the update
    const verifyResult = await client.query(
      'SELECT id, email, user_type FROM users WHERE email = $1',
      ['admin@strongauto.com']
    );
    console.log('Verification result:', verifyResult.rows);
    
    console.log('✓ Operation completed successfully');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
