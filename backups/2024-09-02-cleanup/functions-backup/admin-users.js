// Admin User Management API for AutoStreamPro
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

        // Verify admin token
        const authHeader = event.headers.authorization || event.headers.Authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Admin token required' })
            };
        }

        const token = authHeader.substring(7);
        let adminUser;
        
        try {
            adminUser = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
            if (adminUser.role !== 'admin') {
                throw new Error('Not an admin');
            }
        } catch (authError) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Invalid admin token' })
            };
        }

        // Parse request based on method
        let requestData = {};
        if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
            requestData = JSON.parse(event.body || '{}');
        }

        const { userId, action, ...data } = requestData;
        const queryParams = event.queryStringParameters || {};

        console.log(`Admin Users API: ${event.httpMethod} ${action || 'query'} by ${adminUser.email}`);

        // Handle different actions based on HTTP method
        switch (event.httpMethod) {
            case 'GET':
                if (queryParams.userId) {
                    return await getUserDetails(queryParams.userId, supabase, headers);
                } else {
                    return await getUsers(queryParams, supabase, headers);
                }
                
            case 'POST':
                switch (action) {
                    case 'suspend':
                        return await suspendUser(userId, supabase, headers);
                    case 'activate':
                        return await activateUser(userId, supabase, headers);
                    case 'delete':
                        return await deleteUser(userId, supabase, headers);
                    case 'updateProfile':
                        return await updateUserProfile(userId, data, supabase, headers);
                    case 'resetPassword':
                        return await resetUserPassword(userId, supabase, headers);
                    case 'sendEmail':
                        return await sendUserEmail(userId, data, supabase, headers);
                    default:
                        return {
                            statusCode: 400,
                            headers,
                            body: JSON.stringify({ error: 'Invalid action' })
                        };
                }
                
            default:
                return {
                    statusCode: 405,
                    headers,
                    body: JSON.stringify({ error: 'Method not allowed' })
                };
        }

    } catch (error) {
        console.error('Admin Users API error:', error);
        
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

// Get users with pagination and filtering
async function getUsers(queryParams, supabase, headers) {
    try {
        const {
            page = 1,
            limit = 25,
            search,
            status,
            plan,
            sortBy = 'created_at',
            sortOrder = 'desc'
        } = queryParams;

        const offset = (page - 1) * limit;

        // Build query
        let query = supabase
            .from('user_profiles')
            .select(`
                user_id,
                email,
                full_name,
                subscription_status,
                subscription_plan,
                is_family_member,
                is_suspended,
                created_at,
                updated_at,
                last_active,
                stripe_customer_id,
                trial_ends_at,
                user_subscriptions (
                    status,
                    plan,
                    trial_end,
                    current_period_end
                )
            `)
            .range(offset, offset + limit - 1);

        // Apply filters
        if (search) {
            query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
        }

        if (status) {
            if (status === 'suspended') {
                query = query.eq('is_suspended', true);
            } else if (status === 'active') {
                query = query.eq('is_suspended', false);
            } else if (status === 'family') {
                query = query.eq('is_family_member', true);
            }
        }

        if (plan) {
            query = query.eq('subscription_plan', plan);
        }

        // Apply sorting
        query = query.order(sortBy, { ascending: sortOrder === 'asc' });

        const { data: users, error, count } = await query;

        if (error) {
            throw error;
        }

        // Get total count for pagination
        const { count: totalCount } = await supabase
            .from('user_profiles')
            .select('*', { count: 'exact', head: true });

        // Format user data
        const formattedUsers = users.map(user => ({
            id: user.user_id,
            email: user.email,
            fullName: user.full_name,
            subscriptionStatus: user.subscription_status,
            subscriptionPlan: user.subscription_plan,
            isFamilyMember: user.is_family_member,
            isSuspended: user.is_suspended,
            createdAt: user.created_at,
            lastActive: user.last_active,
            stripeCustomerId: user.stripe_customer_id,
            trialEndsAt: user.trial_ends_at,
            subscription: user.user_subscriptions?.[0] || null
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                users: formattedUsers,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount || 0,
                    pages: Math.ceil((totalCount || 0) / limit)
                }
            })
        };

    } catch (error) {
        console.error('Error getting users:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get users',
                message: error.message
            })
        };
    }
}

// Get detailed user information
async function getUserDetails(userId, supabase, headers) {
    try {
        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select(`
                *,
                user_subscriptions (*),
                promo_code_uses (
                    code,
                    used_at,
                    promo_codes (
                        code,
                        discount_type,
                        discount_value
                    )
                )
            `)
            .eq('user_id', userId)
            .single();

        if (profileError) {
            throw profileError;
        }

        if (!profile) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'User not found' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: profile
            })
        };

    } catch (error) {
        console.error('Error getting user details:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get user details',
                message: error.message
            })
        };
    }
}

// Suspend user
async function suspendUser(userId, supabase, headers) {
    try {
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            };
        }

        const { data, error } = await supabase
            .from('user_profiles')
            .update({
                is_suspended: true,
                suspended_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        console.log(`User suspended: ${userId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: data,
                message: 'User suspended successfully'
            })
        };

    } catch (error) {
        console.error('Error suspending user:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to suspend user',
                message: error.message
            })
        };
    }
}

// Activate user
async function activateUser(userId, supabase, headers) {
    try {
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            };
        }

        const { data, error } = await supabase
            .from('user_profiles')
            .update({
                is_suspended: false,
                suspended_at: null,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        console.log(`User activated: ${userId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: data,
                message: 'User activated successfully'
            })
        };

    } catch (error) {
        console.error('Error activating user:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to activate user',
                message: error.message
            })
        };
    }
}

// Delete user
async function deleteUser(userId, supabase, headers) {
    try {
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            };
        }

        // Soft delete by marking as deleted
        const { data, error } = await supabase
            .from('user_profiles')
            .update({
                is_deleted: true,
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        console.log(`User deleted (soft): ${userId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: data,
                message: 'User deleted successfully'
            })
        };

    } catch (error) {
        console.error('Error deleting user:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to delete user',
                message: error.message
            })
        };
    }
}

// Update user profile
async function updateUserProfile(userId, updateData, supabase, headers) {
    try {
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            };
        }

        const allowedFields = [
            'full_name',
            'subscription_plan',
            'subscription_status',
            'notes'
        ];

        const filteredData = {};
        Object.keys(updateData).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredData[key] = updateData[key];
            }
        });

        filteredData.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('user_profiles')
            .update(filteredData)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        console.log(`User profile updated: ${userId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                user: data,
                message: 'User profile updated successfully'
            })
        };

    } catch (error) {
        console.error('Error updating user profile:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to update user profile',
                message: error.message
            })
        };
    }
}

// Reset user password
async function resetUserPassword(userId, supabase, headers) {
    try {
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            };
        }

        // Get user email
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('email')
            .eq('user_id', userId)
            .single();

        if (profileError || !profile) {
            throw new Error('User not found');
        }

        // Send password reset email via Supabase Auth
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
            profile.email,
            {
                redirectTo: `${process.env.SITE_URL}/reset-password`
            }
        );

        if (resetError) {
            throw resetError;
        }

        console.log(`Password reset sent to: ${profile.email}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Password reset email sent successfully'
            })
        };

    } catch (error) {
        console.error('Error sending password reset:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to send password reset',
                message: error.message
            })
        };
    }
}

// Send email to user
async function sendUserEmail(userId, emailData, supabase, headers) {
    try {
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'User ID is required' })
            };
        }

        // This would need integration with an email service like SendGrid
        // For now, just log the email intention
        console.log(`Email to user ${userId}:`, emailData);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Email functionality not yet implemented'
            })
        };

    } catch (error) {
        console.error('Error sending email:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to send email',
                message: error.message
            })
        };
    }
}