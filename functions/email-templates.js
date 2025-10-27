// netlify/functions/email-templates.js

const templates = {
  welcome: (userName) => ({
    subject: 'Welcome to AutoStreamPro! 🚀',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
            .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to AutoStreamPro!</h1>
            </div>
            <div class="content">
              <p>Hi ${userName || 'there'},</p>
              <p>You're all set! Your AI-powered clip generator is ready to turn your streams into viral content.</p>
              
              <h3>🎯 Quick Start:</h3>
              <ol>
                <li>Connect your streaming platforms (Twitch, YouTube, Kick)</li>
                <li>Set your virality threshold (we recommend starting at 40%)</li>
                <li>Let AI analyze and auto-publish your best moments</li>
              </ol>
              
              <p>Your 14-day free trial has started. No credit card required!</p>
              
              <a href="https://www.autostreampro.com/dashboard" class="button">Go to Dashboard</a>
              
              <p>Need help? Reply to this email or check our docs.</p>
            </div>
            <div class="footer">
              <p>© 2025 AutoStreamPro. Auto-clips that actually go viral.</p>
            </div>
          </div>
        </body>
      </html>
    `
  }),

  trialEnding: (userName, daysLeft) => ({
    subject: `Your AutoStreamPro trial ends in ${daysLeft} days`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #fbbf24; color: #78350f; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
            .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
            .pricing { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⏰ Trial Ending Soon</h1>
            </div>
            <div class="content">
              <p>Hi ${userName || 'there'},</p>
              <p>Your AutoStreamPro trial ends in <strong>${daysLeft} days</strong>.</p>
              
              <div class="pricing">
                <h3>Choose Your Plan:</h3>
                <ul>
                  <li><strong>Starter ($20/mo)</strong> - Perfect for new streamers</li>
                  <li><strong>Pro ($50/mo)</strong> - Most popular! Unlimited clips</li>
                  <li><strong>Enterprise ($75/mo)</strong> - For teams & agencies</li>
                </ul>
              </div>
              
              <a href="https://www.autostreampro.com/pricing" class="button">Upgrade Now</a>
              
              <p>Don't lose your clips and settings! Upgrade to keep everything running smoothly.</p>
            </div>
          </div>
        </body>
      </html>
    `
  }),

  passwordReset: (resetLink) => ({
    subject: 'Reset your AutoStreamPro password',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-radius: 10px; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
            .warning { background: #fef2f2; border: 1px solid #fca5a5; padding: 15px; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <h2>Password Reset Request</h2>
              <p>We received a request to reset your AutoStreamPro password.</p>
              
              <a href="${resetLink}" class="button">Reset Password</a>
              
              <div class="warning">
                <p><strong>⚠️ Important:</strong> This link expires in 1 hour for security reasons.</p>
                <p>If you didn't request this, please ignore this email.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `
  }),

  clipPublished: (clipTitle, platform, clipUrl) => ({
    subject: `🎬 New clip published: "${clipTitle}"`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-radius: 10px; }
            .success { background: #f0fdf4; border: 1px solid #86efac; padding: 20px; border-radius: 8px; text-align: center; }
            .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <div class="success">
                <h2>🎉 Clip Published Successfully!</h2>
              </div>
              
              <h3>"${clipTitle}"</h3>
              <p>Your clip has been published to ${platform}!</p>
              
              <a href="${clipUrl}" class="button">View Clip</a>
              
              <p>Track its performance in your dashboard.</p>
            </div>
          </div>
        </body>
      </html>
    `
  })
};

// Export for use in other functions
module.exports = { templates };

// Also create a standalone handler for testing
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      message: 'Email templates loaded',
      availableTemplates: Object.keys(templates)
    })
  };
};