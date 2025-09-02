// Admin Promo Code Management API for AutoStreamPro
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

        const { promoId, action, ...data } = requestData;
        const queryParams = event.queryStringParameters || {};

        console.log(`Admin Promo Codes API: ${event.httpMethod} ${action || 'query'} by ${adminUser.email}`);

        // Handle different actions based on HTTP method
        switch (event.httpMethod) {
            case 'GET':
                if (queryParams.promoId) {
                    return await getPromoCodeDetails(queryParams.promoId, supabase, headers);
                } else if (queryParams.analytics) {
                    return await getPromoCodeAnalytics(queryParams, supabase, headers);
                } else {
                    return await getPromoCodes(queryParams, supabase, headers);
                }
                
            case 'POST':
                switch (action) {
                    case 'create':
                        return await createPromoCode(data, adminUser, supabase, headers);
                    case 'validate':
                        return await validatePromoCode(data.code, supabase, headers);
                    case 'deactivate':
                        return await deactivatePromoCode(promoId, supabase, headers);
                    case 'activate':
                        return await activatePromoCode(promoId, supabase, headers);
                    default:
                        return {
                            statusCode: 400,
                            headers,
                            body: JSON.stringify({ error: 'Invalid action' })
                        };
                }
                
            case 'PUT':
                return await updatePromoCode(promoId, data, supabase, headers);
                
            case 'DELETE':
                return await deletePromoCode(promoId, supabase, headers);
                
            default:
                return {
                    statusCode: 405,
                    headers,
                    body: JSON.stringify({ error: 'Method not allowed' })
                };
        }

    } catch (error) {
        console.error('Admin Promo Codes API error:', error);
        
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

// Get promo codes with pagination and filtering
async function getPromoCodes(queryParams, supabase, headers) {
    try {
        const {
            page = 1,
            limit = 25,
            search,
            status,
            createdBy,
            sortBy = 'created_at',
            sortOrder = 'desc'
        } = queryParams;

        const offset = (page - 1) * limit;

        // Build query
        let query = supabase
            .from('promo_codes')
            .select(`
                id,
                code,
                discount_type,
                discount_value,
                max_uses,
                used_count,
                expires_at,
                is_active,
                created_by,
                created_by_email,
                created_at,
                updated_at,
                description
            `)
            .range(offset, offset + limit - 1);

        // Apply filters
        if (search) {
            query = query.or(`code.ilike.%${search}%,description.ilike.%${search}%`);
        }

        if (status) {
            if (status === 'active') {
                query = query.eq('is_active', true);
            } else if (status === 'inactive') {
                query = query.eq('is_active', false);
            } else if (status === 'expired') {
                query = query.lt('expires_at', new Date().toISOString());
            }
        }

        if (createdBy) {
            query = query.eq('created_by', createdBy);
        }

        // Apply sorting
        query = query.order(sortBy, { ascending: sortOrder === 'asc' });

        const { data: promoCodes, error } = await query;

        if (error) {
            throw error;
        }

        // Get total count for pagination
        const { count: totalCount } = await supabase
            .from('promo_codes')
            .select('*', { count: 'exact', head: true });

        // Format promo code data
        const formattedPromoCodes = promoCodes.map(promo => ({
            ...promo,
            isExpired: promo.expires_at ? new Date(promo.expires_at) < new Date() : false,
            isMaxedOut: promo.max_uses && promo.used_count >= promo.max_uses,
            usagePercentage: promo.max_uses ? (promo.used_count / promo.max_uses) * 100 : 0
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                promoCodes: formattedPromoCodes,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount || 0,
                    pages: Math.ceil((totalCount || 0) / limit)
                }
            })
        };

    } catch (error) {
        console.error('Error getting promo codes:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get promo codes',
                message: error.message
            })
        };
    }
}

// Get detailed promo code information
async function getPromoCodeDetails(promoId, supabase, headers) {
    try {
        const { data: promoCode, error } = await supabase
            .from('promo_codes')
            .select(`
                *,
                promo_code_uses (
                    user_id,
                    used_at,
                    user_profiles (
                        email,
                        full_name
                    )
                )
            `)
            .eq('id', promoId)
            .single();

        if (error) {
            throw error;
        }

        if (!promoCode) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Promo code not found' })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                promoCode
            })
        };

    } catch (error) {
        console.error('Error getting promo code details:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get promo code details',
                message: error.message
            })
        };
    }
}

// Get promo code analytics
async function getPromoCodeAnalytics(queryParams, supabase, headers) {
    try {
        const { period = '30d' } = queryParams;
        
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        
        switch (period) {
            case '7d':
                startDate.setDate(endDate.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(endDate.getDate() - 30);
                break;
            case '90d':
                startDate.setDate(endDate.getDate() - 90);
                break;
            case '1y':
                startDate.setFullYear(endDate.getFullYear() - 1);
                break;
        }

        // Get promo code usage analytics
        const { data: totalCodes } = await supabase
            .from('promo_codes')
            .select('id', { count: 'exact' });

        const { data: activeCodes } = await supabase
            .from('promo_codes')
            .select('id', { count: 'exact' })
            .eq('is_active', true);

        const { data: usedCodes } = await supabase
            .from('promo_code_uses')
            .select(`
                promo_code_id,
                used_at,
                promo_codes (
                    discount_type,
                    discount_value
                )
            `)
            .gte('used_at', startDate.toISOString())
            .lte('used_at', endDate.toISOString());

        // Calculate total discount value
        let totalDiscountValue = 0;
        usedCodes?.forEach(usage => {
            if (usage.promo_codes?.discount_type === 'percentage') {
                // For percentage discounts, we'd need to know the order value
                // This is a simplified calculation
                totalDiscountValue += usage.promo_codes.discount_value || 0;
            } else if (usage.promo_codes?.discount_type === 'fixed') {
                totalDiscountValue += usage.promo_codes.discount_value || 0;
            }
        });

        // Top performing codes
        const { data: topCodes } = await supabase
            .from('promo_codes')
            .select('code, used_count, discount_value')
            .gt('used_count', 0)
            .order('used_count', { ascending: false })
            .limit(10);

        // Daily usage chart data
        const dailyUsage = {};
        usedCodes?.forEach(usage => {
            const date = new Date(usage.used_at).toISOString().split('T')[0];
            dailyUsage[date] = (dailyUsage[date] || 0) + 1;
        });

        const chartData = Object.entries(dailyUsage).map(([date, usage]) => ({
            date,
            usage
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                analytics: {
                    period,
                    totalCodes: totalCodes?.length || 0,
                    activeCodes: activeCodes?.length || 0,
                    totalUses: usedCodes?.length || 0,
                    totalDiscountValue,
                    topPerformingCodes: topCodes || [],
                    chartData
                }
            })
        };

    } catch (error) {
        console.error('Error getting promo code analytics:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get promo code analytics',
                message: error.message
            })
        };
    }
}

// Create new promo code
async function createPromoCode(data, adminUser, supabase, headers) {
    try {
        const {
            code,
            description,
            discountType,
            discountValue,
            maxUses,
            expiresAt
        } = data;

        // Validate required fields
        if (!code || !discountType || !discountValue) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Code, discount type, and discount value are required'
                })
            };
        }

        // Check if code already exists
        const { data: existingCode } = await supabase
            .from('promo_codes')
            .select('id')
            .eq('code', code.toUpperCase())
            .single();

        if (existingCode) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    error: 'Promo code already exists'
                })
            };
        }

        // Create promo code
        const { data: newPromoCode, error } = await supabase
            .from('promo_codes')
            .insert({
                code: code.toUpperCase(),
                description: description || '',
                discount_type: discountType,
                discount_value: discountValue,
                max_uses: maxUses || null,
                expires_at: expiresAt || null,
                is_active: true,
                created_by: adminUser.userId,
                created_by_email: adminUser.email,
                used_count: 0
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        console.log(`Promo code created: ${code} by ${adminUser.email}`);

        return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
                success: true,
                promoCode: newPromoCode,
                message: 'Promo code created successfully'
            })
        };

    } catch (error) {
        console.error('Error creating promo code:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to create promo code',
                message: error.message
            })
        };
    }
}

// Validate promo code
async function validatePromoCode(code, supabase, headers) {
    try {
        if (!code) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Promo code is required' })
            };
        }

        const { data: promoCode, error } = await supabase
            .from('promo_codes')
            .select('*')
            .eq('code', code.toUpperCase())
            .eq('is_active', true)
            .single();

        if (error || !promoCode) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({
                    valid: false,
                    error: 'Invalid promo code'
                })
            };
        }

        // Check if expired
        if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date()) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    valid: false,
                    error: 'Promo code has expired'
                })
            };
        }

        // Check usage limit
        if (promoCode.max_uses && promoCode.used_count >= promoCode.max_uses) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    valid: false,
                    error: 'Promo code usage limit reached'
                })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                valid: true,
                promoCode: {
                    id: promoCode.id,
                    code: promoCode.code,
                    discountType: promoCode.discount_type,
                    discountValue: promoCode.discount_value,
                    description: promoCode.description
                }
            })
        };

    } catch (error) {
        console.error('Error validating promo code:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to validate promo code',
                message: error.message
            })
        };
    }
}

// Deactivate promo code
async function deactivatePromoCode(promoId, supabase, headers) {
    try {
        if (!promoId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Promo code ID is required' })
            };
        }

        const { data, error } = await supabase
            .from('promo_codes')
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', promoId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                promoCode: data,
                message: 'Promo code deactivated successfully'
            })
        };

    } catch (error) {
        console.error('Error deactivating promo code:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to deactivate promo code',
                message: error.message
            })
        };
    }
}

// Activate promo code
async function activatePromoCode(promoId, supabase, headers) {
    try {
        if (!promoId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Promo code ID is required' })
            };
        }

        const { data, error } = await supabase
            .from('promo_codes')
            .update({
                is_active: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', promoId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                promoCode: data,
                message: 'Promo code activated successfully'
            })
        };

    } catch (error) {
        console.error('Error activating promo code:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to activate promo code',
                message: error.message
            })
        };
    }
}

// Update promo code
async function updatePromoCode(promoId, updateData, supabase, headers) {
    try {
        if (!promoId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Promo code ID is required' })
            };
        }

        const allowedFields = [
            'description',
            'discount_value',
            'max_uses',
            'expires_at'
        ];

        const filteredData = {};
        Object.keys(updateData).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredData[key] = updateData[key];
            }
        });

        filteredData.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('promo_codes')
            .update(filteredData)
            .eq('id', promoId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                promoCode: data,
                message: 'Promo code updated successfully'
            })
        };

    } catch (error) {
        console.error('Error updating promo code:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to update promo code',
                message: error.message
            })
        };
    }
}

// Delete promo code
async function deletePromoCode(promoId, supabase, headers) {
    try {
        if (!promoId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Promo code ID is required' })
            };
        }

        const { error } = await supabase
            .from('promo_codes')
            .delete()
            .eq('id', promoId);

        if (error) {
            throw error;
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Promo code deleted successfully'
            })
        };

    } catch (error) {
        console.error('Error deleting promo code:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to delete promo code',
                message: error.message
            })
        };
    }
}