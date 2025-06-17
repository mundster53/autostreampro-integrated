// Admin Authentication API for AutoStreamPro
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    try {
        // Initialize Supabase
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Admin email addresses (family members)
        const adminEmails = [
            process.env.ADMIN_EMAIL_1, // mundt53@gmail.com
            process.env.ADMIN_EMAIL_2, // duncanmundt1@gmail.com
            process.env.ADMIN_EMAIL_3, // mundstermom@gmail.com
            process.env.ADMIN_EMAIL_4, // ChristianMundt95@gmail.com
            process.env.ADMIN_EMAIL_5, // jordanmundt1@gmail.com
            process.env.ADMIN_EMAIL_6  // julia.elaine.lee@gmail.com
        ].filter(Boolean);

        console.log('Admin Auth API called:', event.httpMethod);

        if (event.httpMethod === 'POST') {
            // Admin login
            const { email, password } = JSON.parse(event.body);

            if (!email || !password) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Email and password are required'
                    })
                };
            }

            // Check if email is authorized admin
            if (!adminEmails.includes(email.toLowerCase())) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: 'Access denied: Not an authorized admin'
                    })
                };
            }

            // Authenticate with Supabase
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (authError) {
                console.error('Admin auth error:', authError);
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: 'Invalid credentials',
                        message: authError.message
                    })
                };
            }

            // Get user profile
            const { data: profile, error: profileError } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('user_id', authData.user.id)
                .single();

            if (profileError) {
                console.error('Profile fetch error:', profileError);
            }

            // Create admin JWT token
            const adminToken = jwt.sign(
                {
                    userId: authData.user.id,
                    email: authData.user.email,
                    role: 'admin',
                    isFamily: true,
                    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
                },
                process.env.JWT_SECRET || 'fallback-secret-key'
            );

            console.log(`Admin login successful: ${email}`);

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    token: adminToken,
                    user: {
                        id: authData.user.id,
                        email: authData.user.email,
                        role: 'admin',
                        isFamily: true,
                        profile: profile || {}
                    },
                    message: 'Admin authentication successful'
                })
            };

        } else if (event.httpMethod === 'GET') {
            // Verify admin token
            const authHeader = event.headers.authorization || event.headers.Authorization;
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: 'Admin token required'
                    })
                };
            }

            const token = authHeader.substring(7);

            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
                
                if (decoded.role !== 'admin' || !adminEmails.includes(decoded.email.toLowerCase())) {
                    throw new Error('Not an admin');
                }

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        valid: true,
                        user: {
                            id: decoded.userId,
                            email: decoded.email,
                            role: decoded.role,
                            isFamily: decoded.isFamily
                        }
                    })
                };

            } catch (tokenError) {
                console.error('Token verification error:', tokenError);
                return {
                    statusCode: 401,
                    headers,
                    body: JSON.stringify({
                        error: 'Invalid or expired admin token'
                    })
                };
            }

        } else {
            return {
                statusCode: 405,
                headers,
                body: JSON.stringify({
                    error: 'Method not allowed'
                })
            };
        }

    } catch (error) {
        console.error('Admin Auth API error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};