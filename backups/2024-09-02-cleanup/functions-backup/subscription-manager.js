// Subscription Manager for AutoStreamPro with Supabase
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Initialize Stripe and Supabase
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Parse request body
        const { action, userId, ...data } = JSON.parse(event.body);

        // Validate required fields
        if (!action || !userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Missing required fields: action, userId' 
                })
            };
        }

        console.log(`Subscription Manager: ${action} for user ${userId}`);

        // Handle different actions
        switch (action) {
            case 'getSubscription':
                return await getSubscription(userId, stripe, supabase, headers);
                
            case 'cancelSubscription':
                return await cancelSubscription(userId, data.immediately, stripe, supabase, headers);
                
            case 'resumeSubscription':
                return await resumeSubscription(userId, stripe, supabase, headers);
                
            case 'changePlan':
                return await changePlan(userId, data.newPlan, stripe, supabase, headers);
                
            case 'createBillingPortal':
                return await createBillingPortal(userId, data.returnUrl, stripe, supabase, headers);
                
            case 'updatePaymentMethod':
                return await updatePaymentMethod(userId, data.paymentMethodId, stripe, supabase, headers);
                
            case 'getInvoices':
                return await getInvoices(userId, stripe, supabase, headers);
                
            case 'downloadInvoice':
                return await downloadInvoice(userId, data.invoiceId, stripe, supabase, headers);
                
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Invalid action' })
                };
        }

    } catch (error) {
        console.error('Subscription Manager error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};

// Get user subscription details
async function getSubscription(userId, stripe, supabase, headers) {
    try {
        // Get subscription from Supabase
        const { data: userSub, error } = await supabase
            .from('user_subscriptions')
            .select('*')
            .eq('supabase_user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        if (!userSub || !userSub.stripe_subscription_id) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    subscription: null,
                    message: 'No active subscription found'
                })
            };
        }

        // Get full subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(userSub.stripe_subscription_id, {
            expand: ['latest_invoice', 'customer', 'items.data.price.product']
        });

        const subscriptionDetails = {
            id: subscription.id,
            status: subscription.status,
            plan: getPlanFromSubscription(subscription),
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
            latest_invoice: subscription.latest_invoice ? {
                id: subscription.latest_invoice.id,
                amount_paid: subscription.latest_invoice.amount_paid,
                status: subscription.latest_invoice.status,
                created: new Date(subscription.latest_invoice.created * 1000).toISOString()
            } : null,
            customer: {
                email: subscription.customer.email,
                name: subscription.customer.name
            }
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                subscription: subscriptionDetails,
                message: 'Subscription details retrieved successfully'
            })
        };

    } catch (error) {
        console.error('Error getting subscription:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get subscription',
                message: error.message
            })
        };
    }
}

// Cancel subscription
async function cancelSubscription(userId, immediately, stripe, supabase, headers) {
    try {
        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        // Get user's subscription
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.stripe_customer_id,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            throw new Error('No active subscription found');
        }

        const subscription = subscriptions.data[0];

        let cancelledSubscription;
        if (immediately) {
            // Cancel immediately
            cancelledSubscription = await stripe.subscriptions.cancel(subscription.id);
        } else {
            // Cancel at period end
            cancelledSubscription = await stripe.subscriptions.update(subscription.id, {
                cancel_at_period_end: true
            });
        }

        // Update Supabase
        await supabase
            .from('user_subscriptions')
            .update({
                status: immediately ? 'cancelled' : subscription.status,
                cancel_at_period_end: !immediately,
                cancelled_at: immediately ? new Date().toISOString() : null,
                updated_at: new Date().toISOString()
            })
            .eq('supabase_user_id', userId);

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

// Resume subscription
async function resumeSubscription(userId, stripe, supabase, headers) {
    try {
        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        // Get user's subscription
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.stripe_customer_id,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            throw new Error('No active subscription found');
        }

        const subscription = subscriptions.data[0];

        // Resume subscription by removing cancel_at_period_end
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
            cancel_at_period_end: false
        });

        // Update Supabase
        await supabase
            .from('user_subscriptions')
            .update({
                cancel_at_period_end: false,
                updated_at: new Date().toISOString()
            })
            .eq('supabase_user_id', userId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                subscription: updatedSubscription,
                message: 'Subscription resumed successfully'
            })
        };

    } catch (error) {
        console.error('Error resuming subscription:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to resume subscription',
                message: error.message
            })
        };
    }
}

// Change subscription plan
async function changePlan(userId, newPlan, stripe, supabase, headers) {
    try {
        // Define plan pricing
        const planPricing = {
            'starter': { amount: 2000, name: 'AutoStreamPro Starter' },
            'expert': { amount: 5000, name: 'AutoStreamPro Expert' },
            'pro': { amount: 7500, name: 'AutoStreamPro Pro' }
        };

        if (!planPricing[newPlan]) {
            throw new Error('Invalid plan selected');
        }

        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        // Get user's subscription
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.stripe_customer_id,
            status: 'active'
        });

        if (subscriptions.data.length === 0) {
            throw new Error('No active subscription found');
        }

        const subscription = subscriptions.data[0];

        // Get or create new price
        const newPrice = await getOrCreatePrice(newPlan, planPricing[newPlan], stripe);

        // Update subscription
        const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
            items: [{
                id: subscription.items.data[0].id,
                price: newPrice.id,
            }],
            proration_behavior: 'always_invoice',
            metadata: {
                ...subscription.metadata,
                plan: newPlan
            }
        });

        // Update Supabase
        await supabase
            .from('user_subscriptions')
            .update({
                plan: newPlan,
                updated_at: new Date().toISOString()
            })
            .eq('supabase_user_id', userId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                subscription: updatedSubscription,
                message: `Plan changed to ${newPlan} successfully`
            })
        };

    } catch (error) {
        console.error('Error changing plan:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to change plan',
                message: error.message
            })
        };
    }
}

// Create billing portal session
async function createBillingPortal(userId, returnUrl, stripe, supabase, headers) {
    try {
        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: customer.stripe_customer_id,
            return_url: returnUrl || `${process.env.SITE_URL}/dashboard.html`,
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                url: session.url,
                message: 'Billing portal session created successfully'
            })
        };

    } catch (error) {
        console.error('Error creating billing portal:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to create billing portal',
                message: error.message
            })
        };
    }
}

// Update payment method
async function updatePaymentMethod(userId, paymentMethodId, stripe, supabase, headers) {
    try {
        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        // Attach payment method to customer
        await stripe.paymentMethods.attach(paymentMethodId, {
            customer: customer.stripe_customer_id,
        });

        // Set as default payment method
        await stripe.customers.update(customer.stripe_customer_id, {
            invoice_settings: {
                default_payment_method: paymentMethodId,
            },
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Payment method updated successfully'
            })
        };

    } catch (error) {
        console.error('Error updating payment method:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to update payment method',
                message: error.message
            })
        };
    }
}

// Get user invoices
async function getInvoices(userId, stripe, supabase, headers) {
    try {
        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        const invoices = await stripe.invoices.list({
            customer: customer.stripe_customer_id,
            limit: 20
        });

        const formattedInvoices = invoices.data.map(invoice => ({
            id: invoice.id,
            amount_paid: invoice.amount_paid,
            amount_due: invoice.amount_due,
            currency: invoice.currency,
            status: invoice.status,
            created: new Date(invoice.created * 1000).toISOString(),
            period_start: new Date(invoice.period_start * 1000).toISOString(),
            period_end: new Date(invoice.period_end * 1000).toISOString(),
            invoice_pdf: invoice.invoice_pdf,
            hosted_invoice_url: invoice.hosted_invoice_url
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                invoices: formattedInvoices,
                message: 'Invoices retrieved successfully'
            })
        };

    } catch (error) {
        console.error('Error getting invoices:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to get invoices',
                message: error.message
            })
        };
    }
}

// Download invoice
async function downloadInvoice(userId, invoiceId, stripe, supabase, headers) {
    try {
        // Get user's Stripe customer ID
        const customer = await getStripeCustomer(userId, supabase);
        if (!customer) {
            throw new Error('Customer not found');
        }

        const invoice = await stripe.invoices.retrieve(invoiceId);

        // Verify invoice belongs to user
        if (invoice.customer !== customer.stripe_customer_id) {
            throw new Error('Invoice not found or access denied');
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                download_url: invoice.invoice_pdf,
                hosted_url: invoice.hosted_invoice_url,
                message: 'Invoice download links retrieved successfully'
            })
        };

    } catch (error) {
        console.error('Error downloading invoice:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to download invoice',
                message: error.message
            })
        };
    }
}

// Helper functions
async function getStripeCustomer(userId, supabase) {
    try {
        const { data, error } = await supabase
            .from('user_subscriptions')
            .select('stripe_customer_id')
            .eq('supabase_user_id', userId)
            .single();

        if (error || !data) {
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error getting Stripe customer:', error);
        return null;
    }
}

async function getOrCreatePrice(plan, planData, stripe) {
    try {
        // Get or create product
        const products = await stripe.products.list({ limit: 100 });
        let product = products.data.find(p => p.name === planData.name);

        if (!product) {
            product = await stripe.products.create({
                name: planData.name,
                metadata: { plan_type: plan }
            });
        }

        // Get or create price
        const prices = await stripe.prices.list({
            product: product.id,
            limit: 100
        });

        let price = prices.data.find(p => 
            p.unit_amount === planData.amount && 
            p.currency === 'usd' && 
            p.recurring?.interval === 'month'
        );

        if (!price) {
            price = await stripe.prices.create({
                product: product.id,
                unit_amount: planData.amount,
                currency: 'usd',
                recurring: { interval: 'month' },
                metadata: { plan_type: plan }
            });
        }

        return price;
    } catch (error) {
        console.error('Error getting/creating price:', error);
        throw error;
    }
}

function getPlanFromSubscription(subscription) {
    try {
        const metadata = subscription.metadata;
        if (metadata && metadata.plan) {
            return metadata.plan;
        }

        const product = subscription.items.data[0]?.price?.product;
        if (product && product.metadata && product.metadata.plan_type) {
            return product.metadata.plan_type;
        }

        // Fallback based on amount
        const amount = subscription.items.data[0]?.price?.unit_amount;
        switch (amount) {
            case 2000: return 'starter';
            case 5000: return 'expert';
            case 7500: return 'pro';
            default: return 'unknown';
        }
    } catch (error) {
        console.error('Error getting plan from subscription:', error);
        return 'unknown';
    }
}