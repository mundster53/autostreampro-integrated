// test-email-local.js
// This is for local testing only - do not deploy this file

// Test sending a basic email
async function testEmail() {
  try {
    console.log('Testing email send...');
    
    // Use dynamic import for node-fetch
    const fetch = (await import('node-fetch')).default;
    
    // Replace with your test email
    const testEmail = 'mundt53@gmail.com';
    
    const response = await fetch('http://localhost:8888/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: testEmail,
        subject: 'AutoStreamPro Email Test',
        html: '<h1>Test Email</h1><p>If you receive this, email sending is working!</p>'
      })
    });

    const result = await response.json();
    console.log('Email test result:', result);
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testEmail();