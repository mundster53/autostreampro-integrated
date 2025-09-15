// netlify/functions/admin-apply-seo.js
// Admin function to apply SEO to specific users

exports.handler = async (event) => {
    // Security: Only allow specific admin emails
    const adminEmails = [
        'your-email@example.com', // Replace with your email
        'duncan@example.com'      // Duncan's email
    ];
    
    const { userEmail, targetUserId } = JSON.parse(event.body);
    
    // Verify admin
    if (!adminEmails.includes(userEmail)) {
        return {
            statusCode: 403,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }
    
    // Apply SEO to Duncan or specified user
    const response = await fetch(`${process.env.URL}/.netlify/functions/retroactive-seo-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: targetUserId || 'duncan-user-id-here', // Replace with Duncan's actual user ID
            processOldClips: true // This will optimize his existing clips
        })
    });
    
    const result = await response.json();
    
    return {
        statusCode: 200,
        body: JSON.stringify(result)
    };
};