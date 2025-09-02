// Admin Payment Management API for AutoStreamPro
const Stripe = require('stripe');
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
        // Initialize Stripe and Supabase
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
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

        const { action, customerId, subscriptionId, ...data } = requestData;
        const queryParams = event.queryStringParameters || {};

        console.log(`Admin Payments API: ${event.httpMethod} ${action || 'query'} by ${adminUser.email}`);

        // Handle different actions
        switch (event.httpMethod) {
            case 'GET':
                if (queryParams.type === 'analytics') {
                    return await getPaymentAnalytics(queryParams, stripe, supabase, headers);
                } else {
                    return await getPayments(queryParams, stripe, supabase, headers);
                }
                
            case 'POST':
                switch (action) {
                    case 'refund':
                        return await processRefund(data.paymentIntentId, data.amount, data.reason, stripe, headers);
                    case 'cancelSubscription':
                        return await cancelSubscription(subscriptionId, data.immediately, stripe, supabase, headers);
                    case 'updateSubscription':
                        return await updateSubscription(subscriptionId, data, stripe, supabase, headers);
                    case 'createCustomerPortal':
                        return await createCustomerPortal(customerId, stripe, headers);
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
        console.error('Admin Payments API error:', error);
        
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

// Get payments with pagination and filtering
async function getPayments(queryParams, stripe, supabase, headers) {
    try {
        const {
            page = 1,
            limit = 50,
            status,
            plan,
            startDate,
            endDate
        } = queryParams;

        // Get subscriptions from Stripe
        const subscriptionsParams = {
            limit: parseInt(limit),
            starting_after: page > 1 ? undefined : undefined // TODO: Implement proper pagination
        };

        if (status) {
            subscriptionsParams.status = status;
        }

        const subscriptions = await stripe.subscriptions.list(subscriptionsParams);

        // Get payment intents
        const paymentsParams = {
            limit: parseInt(limit)
        };

        if (startDate) {
            paymentsParams.created = { gte: Math.floor(new Date(startDate).getTime() / 1000) };
        }

        if (endDate) {
            paymentsParams.created = { 
                ...paymentsParams.created,
                lte: Math.floor(new Date(endDate).getTime() / 1000) 
            };
        }

        const payments = await stripe.paymentIntents.list(paymentsParams);

        // Get customer details for subscriptions
        const subscriptionDetails = await Promise.all(
            subscriptions.data.map(async (subscription) => {
                try {
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    const price = subscription.items.data[0]?.price;
                    
                    return {
                        id: subscription.id,
                        type: 'subscription',
                        customerId: customer.id,
                        customerEmail: customer.email,
                        customerName: customer.name,
                        status: subscription.status,
                        plan: getPlanFromPrice(price),
                        amount: price?.unit_amount || 0,
                        currency: price?.currency || 'usd',
                        interval: price?.recurring?.interval || 'month',
                        currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
                        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
                        trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
                        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
                        cancelAtPeriodEnd: subscription.cancel_at_period_end,
                        createdAt: new Date(subscription.created * 1000).toISOString()
                    };
                } catch (error) {
                    console.error('Error processing subscription:', error);
                    return null;
                }
            })
        );

        // Get payment details
        const paymentDetails = await Promise.all(
            payments.data.map(async (payment) => {
                try {
                    let customer = null;
                    if (payment.customer) {
                        customer = await stripe.customers.retrieve(payment.customer);
                    }
                    
                    return {
                        id: payment.id,
                        type: 'payment',
                        customerId: customer?.id || null,
                        customerEmail: customer?.email || 'N/A',
                        customerName: customer?.name || 'N/A',
                        status: payment.status,
                        amount: payment.amount,
                        currency: payment.currency,
                        description: payment.description,
                        paymentMethod: payment.payment_method_types?.[0] || 'card',
                        createdAt: new Date(payment.created * 1000).toISOString()
                    };
                } catch (error) {
                    console.error('Error processing payment:', error);
                    return null;
                }
            })
        );

        // Combine and filter results
        const allTransactions = [
            ...subscriptionDetails.filter(Boolean),
            ...paymentDetails.filter(Boolean)
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                transactions: allTransactions,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: allTransactions.length,
                    hasMore: subscriptions.has_more || payments.has_more
                }
            })
        };

    } catch (error) {
        console.error('Error getting payments:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get payments',
                message: error.message
            })
        };
    }
}

// Get payment analytics
async function getPaymentAnalytics(queryParams, stripe, supabase, headers) {
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

        // Get payments from Stripe
        const payments = await stripe.paymentIntents.list({
            created: {
                gte: Math.floor(startDate.getTime() / 1000),
                lte: Math.floor(endDate.getTime() / 1000)
            },
            limit: 100
        });

        // Get subscriptions
        const subscriptions = await stripe.subscriptions.list({
            created: {
                gte: Math.floor(startDate.getTime() / 1000),
                lte: Math.floor(endDate.getTime() / 1000)
            },
            limit: 100
        });

        // Calculate analytics
        const successfulPayments = payments.data.filter(p => p.status === 'succeeded');
        const totalRevenue = successfulPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const averageOrderValue = successfulPayments.length > 0 ? totalRevenue / successfulPayments.length : 0;

        // Subscription analytics
        const activeSubscriptions = subscriptions.data.filter(s => s.status === 'active');
        const trialSubscriptions = subscriptions.data.filter(s => s.status === 'trialing');
        const cancelledSubscriptions = subscriptions.data.filter(s => s.status === 'canceled');

        // Revenue by plan
        const revenueByPlan = {};
        successfulPayments.forEach(payment => {
            // This would need more logic to determine plan from payment
            const plan = 'unknown'; // Placeholder
            revenueByPlan[plan] = (revenueByPlan[plan] || 0) + payment.amount;
        });

        // Daily revenue chart data
        const dailyRevenue = {};
        successfulPayments.forEach(payment => {
            const date = new Date(payment.created * 1000).toISOString().split('T')[0];
            dailyRevenue[date] = (dailyRevenue[date] || 0) + payment.amount;
        });

        const chartData = Object.entries(dailyRevenue).map(([date, revenue]) => ({
            date,
            revenue: revenue / 100 // Convert from cents
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                analytics: {
                    period,
                    totalRevenue: totalRevenue / 100, // Convert from cents
                    totalTransactions: successfulPayments.length,
                    averageOrderValue: averageOrderValue / 100,
                    subscriptions: {
                        active: activeSubscriptions.length,
                        trial: trialSubscriptions.length,
                        cancelled: cancelledSubscriptions.length,
                        total: subscriptions.data.length
                    },
                    revenueByPlan,
                    chartData
                }
            })
        };

    } catch (error) {
        console.error('Error getting payment analytics:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get payment analytics',
                message: error.message
            })
        };
    }
}

// Process refund
async function processRefund(paymentIntentId, amount, reason, stripe, headers) {
    try {
        if (!paymentIntentId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Payment Intent ID is required' 
                })
            };
        }

        const refundData = {
            payment_intent: paymentIntentId,
            reason: reason || 'requested_by_customer'
        };

        if (amount) {
            refundData.amount = Math.round(amount * 100); // Convert to cents
        }

        const refund = await stripe.refunds.create(refundData);

        console.log(`Refund processed: ${refund.id} for payment ${paymentIntentId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                refund: {
                    id: refund.id,
                    amount: refund.amount / 100,
                    currency: refund.currency,
                    status: refund.status,
                    reason: refund.reason
                },
                message: 'Refund processed successfully'
            })
        };

    } catch (error) {
        console.error('Error processing refund:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to process refund',
                message: error.message
            })
        };
    }
}

// Cancel subscription
async function cancelSubscription(subscriptionId, immediately, stripe, supabase, headers) {
    try {
        if (!subscriptionId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Subscription ID is required' 
                })
            };
        }

        let cancelledSubscription;
        
        if (immediately) {
            cancelledSubscription = await stripe.subscriptions.cancel(subscriptionId);
        } else {
            cancelledSubscription = await stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: true
            });
        }

        // Update Supabase record
        try {
            await supabase
                .from('user_subscriptions')
                .update({
                    status: immediately ? 'cancelled' : 'active',
                    cancel_at_period_end: !immediately,
                    cancelled_at: immediately ? new Date().toISOString() : null,
                    updated_at: new Date().toISOString()
                })
                .eq('stripe_subscription_id', subscriptionId);
        } catch (supabaseError) {
            console.error('Error updating Supabase subscription:', supabaseError);
        }

        console.log(`Subscription ${subscriptionId} ${immediately ? 'cancelled immediately' : 'set to cancel at period end'}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                subscription: cancelledSubscription,
                message: immediately ? 'Subscription cancelled immediately' : 'Subscription will cancel at period end'
            })
        };

    } catch (error) {
        console.error('Error cancelling subscription:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to cancel subscription',
                message: error.message
            })
        };
    }
}

// Update subscription
async function updateSubscription(subscriptionId, updateData, stripe, supabase, headers) {
    try {
        if (!subscriptionId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Subscription ID is required' 
                })
            };
        }

        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, updateData);

        console.log(`Subscription ${subscriptionId} updated`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                subscription: updatedSubscription,
                message: 'Subscription updated successfully'
            })
        };

    } catch (error) {
        console.error('Error updating subscription:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to update subscription',
                message: error.message
            })
        };
    }
}

// Create customer portal session
async function createCustomerPortal(customerId, stripe, headers) {
    try {
        if (!customerId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Customer ID is required' 
                })
            };
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${process.env.SITE_URL}/admin.html`
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                portalUrl: session.url,
                message: 'Customer portal session created'
            })
        };

    } catch (error) {
        console.error('Error creating customer portal:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to create customer portal',
                message: error.message
            })
        };
    }
}

// Helper function to get plan from Stripe price
function getPlanFromPrice(price) {
    if (!price) return 'unknown';
    
    const amount = price.unit_amount;
    switch (amount) {
        case 2000: return 'starter';
        case 5000: return 'expert';
        case 7500: return 'pro';
        default: return 'unknown';
    }
}