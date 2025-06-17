// Family Access Setup API for AutoStreamPro
const { createClient } = require('@supabase/supabase-js');

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

        // Family member email addresses
        const familyEmails = [
            'mundt53@gmail.com',
            'duncanmundt1@gmail.com',
            'mundstermom@gmail.com',
            'ChristianMundt95@gmail.com',
            'jordanmundt1@gmail.com',
            'julia.elaine.lee@gmail.com'
        ];

        console.log('Family Access Setup API called:', event.httpMethod);

        if (event.httpMethod === 'GET') {
            // Check if email is family member
            const { email } = event.queryStringParameters || {};
            
            if (!email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Email parameter is required'
                    })
                };
            }

            const isFamilyMember = familyEmails.includes(email.toLowerCase());
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    isFamilyMember,
                    email: email.toLowerCase()
                })
            };

        } else if (event.httpMethod === 'POST') {
            // Setup family member access
            const { userId, email } = JSON.parse(event.body);

            if (!userId || !email) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'User ID and email are required'
                    })
                };
            }

            // Check if email is family member
            const isFamilyMember = familyEmails.includes(email.toLowerCase());
            
            if (!isFamilyMember) {
                return {
                    statusCode: 403,
                    headers,
                    body: JSON.stringify({
                        error: 'Email is not authorized for family access'
                    })
                };
            }

            try {
                // Setup family access
                const result = await setupFamilyAccess(userId, email, supabase);
                
                console.log(`Family access setup completed for: ${email}`);

                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({
                        success: true,
                        ...result,
                        message: 'Family access setup completed successfully'
                    })
                };

            } catch (setupError) {
                console.error('Family access setup error:', setupError);
                
                return {
                    statusCode: 500,
                    headers,
                    body: JSON.stringify({
                        error: 'Failed to setup family access',
                        message: setupError.message
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
        console.error('Family Access Setup API error:', error);
        
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

// Setup family member with lifetime Pro access
async function setupFamilyAccess(userId, email, supabase) {
    try {
        const familyEmails = [
            'mundt53@gmail.com',
            'duncanmundt1@gmail.com',
            'mundstermom@gmail.com',
            'ChristianMundt95@gmail.com',
            'jordanmundt1@gmail.com',
            'julia.elaine.lee@gmail.com'
        ];

        // Verify user is family member
        if (!familyEmails.includes(email.toLowerCase())) {
            throw new Error('User is not a family member');
        }

        // First, try to update existing profile
        const { data: existingProfile, error: fetchError } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        let updatedProfile;
        
        if (existingProfile) {
            // Update existing profile
            const { data, error: updateError } = await supabase
                .from('user_profiles')
                .update({
                    is_family_member: true,
                    subscription_status: 'active',
                    subscription_plan: 'pro',
                    subscription_type: 'lifetime',
                    trial_ends_at: null,
                    billing_cycle: 'lifetime',
                    access_level: 'family_admin',
                    updated_at: new Date().toISOString(),
                    family_access_granted_at: new Date().toISOString()
                })
                .eq('user_id', userId)
                .select()
                .single();

            if (updateError) {
                throw new Error(`Failed to update profile: ${updateError.message}`);
            }
            updatedProfile = data;
        } else {
            // Create new profile
            const { data, error: insertError } = await supabase
                .from('user_profiles')
                .insert({
                    user_id: userId,
                    email: email.toLowerCase(),
                    is_family_member: true,
                    subscription_status: 'active',
                    subscription_plan: 'pro',
                    subscription_type: 'lifetime',
                    trial_ends_at: null,
                    billing_cycle: 'lifetime',
                    access_level: 'family_admin',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    family_access_granted_at: new Date().toISOString()
                })
                .select()
                .single();

            if (insertError) {
                throw new Error(`Failed to create profile: ${insertError.message}`);
            }
            updatedProfile = data;
        }

        // Create lifetime subscription record
        const { data: subscription, error: subscriptionError } = await supabase
            .from('user_subscriptions')
            .upsert({
                user_id: userId,
                status: 'active',
                plan: 'pro',
                type: 'lifetime',
                is_family_account: true,
                trial_end: null,
                current_period_start: new Date().toISOString(),
                current_period_end: new Date(2099, 11, 31).toISOString(), // Far future date
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id',
                ignoreDuplicates: false
            })
            .select()
            .single();

        if (subscriptionError) {
            console.error('Subscription creation error:', subscriptionError);
            // Don't throw error here, profile update was successful
        }

        // Grant admin permissions
        const { data: adminPermissions, error: permissionsError } = await supabase
            .from('admin_permissions')
            .upsert({
                user_id: userId,
                email: email.toLowerCase(),
                role: 'family_admin',
                permissions: [
                    'view_users',
                    'manage_users',
                    'view_payments',
                    'manage_payments',
                    'create_promo_codes',
                    'manage_promo_codes',
                    'view_analytics',
                    'full_access'
                ],
                granted_at: new Date().toISOString(),
                granted_by: 'system',
                is_active: true
            }, {
                onConflict: 'user_id',
                ignoreDuplicates: false
            })
            .select()
            .single();

        if (permissionsError) {
            console.error('Admin permissions error:', permissionsError);
            // Don't throw error, core access was granted
        }

        // Create activity log
        const { error: logError } = await supabase
            .from('user_activity_logs')
            .insert({
                user_id: userId,
                activity_type: 'family_access_granted',
                activity_data: {
                    email: email.toLowerCase(),
                    plan: 'pro',
                    type: 'lifetime',
                    granted_at: new Date().toISOString()
                },
                created_at: new Date().toISOString()
            });

        if (logError) {
            console.error('Activity log error:', logError);
            // Don't throw error, this is just for tracking
        }

        console.log(`Family access successfully setup for user: ${userId} (${email})`);

        return {
            profile: updatedProfile,
            subscription: subscription,
            adminPermissions: adminPermissions,
            accessLevel: 'family_admin',
            lifetimeAccess: true
        };

    } catch (error) {
        console.error('Setup family access error:', error);
        throw error;
    }
}

// Helper function to validate family member email
function isFamilyMember(email) {
    const familyEmails = [
        'mundt53@gmail.com',
        'duncanmundt1@gmail.com',
        'mundstermom@gmail.com',
        'ChristianMundt95@gmail.com',
        'jordanmundt1@gmail.com',
        'julia.elaine.lee@gmail.com'
    ];
    
    return familyEmails.includes(email.toLowerCase());
}

// Helper function to get family member info
function getFamilyMemberInfo(email) {
    const familyMembers = {
        'mundt53@gmail.com': {
            name: 'Primary Admin',
            role: 'Owner',
            accessLevel: 'full'
        },
        'duncanmundt1@gmail.com': {
            name: 'Duncan Mundt',
            role: 'Co-Owner',
            accessLevel: 'full'
        },
        'mundstermom@gmail.com': {
            name: 'Lori Mundt',
            role: 'Family Admin',
            accessLevel: 'admin'
        },
        'ChristianMundt95@gmail.com': {
            name: 'Christian Mundt',
            role: 'Family Admin',
            accessLevel: 'admin'
        },
        'jordanmundt1@gmail.com': {
            name: 'Jordan Mundt',
            role: 'Family Admin',
            accessLevel: 'admin'
        },
        'julia.elaine.lee@gmail.com': {
            name: 'Julia Lee Mundt',
            role: 'Family Admin',
            accessLevel: 'admin'
        }
    };
    
    return familyMembers[email.toLowerCase()] || null;
}
