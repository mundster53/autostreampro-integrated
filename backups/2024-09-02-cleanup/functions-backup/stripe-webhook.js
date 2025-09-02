// Stripe Webhook Handler for AutoStreamPro with Supabase
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
    // CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Stripe-Signature',
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

        // Verify webhook signature
        const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
        let stripeEvent;

        try {
            stripeEvent = stripe.webhooks.constructEvent(
                event.body,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Webhook signature verification failed' })
            };
        }

        console.log(`Stripe webhook received: ${stripeEvent.type}`);

        // Handle different event types
        switch (stripeEvent.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(stripeEvent.data.object, stripe, supabase);
                break;

            case 'customer.subscription.created':
                await handleSubscriptionCreated(stripeEvent.data.object, stripe, supabase);
                break;

            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(stripeEvent.data.object, stripe, supabase);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(stripeEvent.data.object, stripe, supabase);
                break;

            case 'invoice.payment_succeeded':
                await handlePaymentSucceeded(stripeEvent.data.object, stripe, supabase);
                break;

            case 'invoice.payment_failed':
                await handlePaymentFailed(stripeEvent.data.object, stripe, supabase);
                break;

            case 'customer.subscription.trial_will_end':
                await handleTrialWillEnd(stripeEvent.data.object, stripe, supabase);
                break;

            default:
                console.log(`Unhandled event type: ${stripeEvent.type}`);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ received: true })
        };

    } catch (error) {
        console.error('Webhook handler error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Webhook handler failed',
                message: error.message
            })
        };
    }
};

// Handle successful checkout completion
async function handleCheckoutCompleted(session, stripe, supabase) {
    try {
        console.log('Checkout completed for session:', session.id);

        const supabaseUserId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan;

        if (!supabaseUserId) {
            console.error('No Supabase user ID in checkout session metadata');
            return;
        }

        // Update user subscription status
        await updateUserSubscription(supabaseUserId, {
            status: 'trial',
            plan: plan,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            trial_start: new Date().toISOString(),
            trial_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        }, supabase);

        console.log(`User ${supabaseUserId} trial started successfully`);

    } catch (error) {
        console.error('Error handling checkout completed:', error);
    }
}

// Handle subscription creation
async function handleSubscriptionCreated(subscription, stripe, supabase) {
    try {
        console.log('Subscription created:', subscription.id);

        const supabaseUserId = subscription.metadata?.supabase_user_id;
        
        if (!supabaseUserId) {
            // Try to get user ID from customer metadata
            const customer = await stripe.customers.retrieve(subscription.customer);
            const customerUserId = customer.metadata?.supabase_user_id;
            
            if (!customerUserId) {
                console.error('No Supabase user ID found in subscription or customer metadata');
                return;
            }
            
            await updateUserSubscription(customerUserId, {
                status: subscription.status,
                stripe_subscription_id: subscription.id,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
            }, supabase);
        } else {
            await updateUserSubscription(supabaseUserId, {
                status: subscription.status,
                stripe_subscription_id: subscription.id,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
            }, supabase);
        }

    } catch (error) {
        console.error('Error handling subscription created:', error);
    }
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription, stripe, supabase) {
    try {
        console.log('Subscription updated:', subscription.id);

        const supabaseUserId = subscription.metadata?.supabase_user_id;
        
        if (!supabaseUserId) {
            // Try to get user ID from customer metadata
            const customer = await stripe.customers.retrieve(subscription.customer);
            const customerUserId = customer.metadata?.supabase_user_id;
            
            if (!customerUserId) {
                console.error('No Supabase user ID found in subscription or customer metadata');
                return;
            }
            
            await updateUserSubscription(customerUserId, {
                status: subscription.status,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                cancel_at_period_end: subscription.cancel_at_period_end
            }, supabase);
        } else {
            await updateUserSubscription(supabaseUserId, {
                status: subscription.status,
                current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                cancel_at_period_end: subscription.cancel_at_period_end
            }, supabase);
        }

    } catch (error) {
        console.error('Error handling subscription updated:', error);
    }
}

// Handle subscription deletion
async function handleSubscriptionDeleted(subscription, stripe, supabase) {
    try {
        console.log('Subscription deleted:', subscription.id);

        const supabaseUserId = subscription.metadata?.supabase_user_id;
        
        if (!supabaseUserId) {
            // Try to get user ID from customer metadata
            const customer = await stripe.customers.retrieve(subscription.customer);
            const customerUserId = customer.metadata?.supabase_user_id;
            
            if (!customerUserId) {
                console.error('No Supabase user ID found in subscription or customer metadata');
                return;
            }
            
            await updateUserSubscription(customerUserId, {
                status: 'cancelled',
                cancelled_at: new Date().toISOString()
            }, supabase);
        } else {
            await updateUserSubscription(supabaseUserId, {
                status: 'cancelled',
                cancelled_at: new Date().toISOString()
            }, supabase);
        }

    } catch (error) {
        console.error('Error handling subscription deleted:', error);
    }
}

// Handle successful payment
async function handlePaymentSucceeded(invoice, stripe, supabase) {
    try {
        console.log('Payment succeeded for invoice:', invoice.id);

        if (invoice.subscription) {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
            const supabaseUserId = subscription.metadata?.supabase_user_id;
            
            if (!supabaseUserId) {
                // Try to get user ID from customer metadata
                const customer = await stripe.customers.retrieve(subscription.customer);
                const customerUserId = customer.metadata?.supabase_user_id;
                
                if (!customerUserId) {
                    console.error('No Supabase user ID found for payment success');
                    return;
                }
                
                await updateUserSubscription(customerUserId, {
                    status: 'active',
                    last_payment_date: new Date().toISOString(),
                    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                    current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
                }, supabase);
            } else {
                await updateUserSubscription(supabaseUserId, {
                    status: 'active',
                    last_payment_date: new Date().toISOString(),
                    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                    current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
                }, supabase);
            }
        }

    } catch (error) {
        console.error('Error handling payment succeeded:', error);
    }
}

// Handle failed payment
async function handlePaymentFailed(invoice, stripe, supabase) {
    try {
        console.log('Payment failed for invoice:', invoice.id);

        if (invoice.subscription) {
            const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
            const supabaseUserId = subscription.metadata?.supabase_user_id;
            
            if (!supabaseUserId) {
                // Try to get user ID from customer metadata
                const customer = await stripe.customers.retrieve(subscription.customer);
                const customerUserId = customer.metadata?.supabase_user_id;
                
                if (!customerUserId) {
                    console.error('No Supabase user ID found for payment failure');
                    return;
                }
                
                await updateUserSubscription(customerUserId, {
                    status: 'past_due',
                    last_payment_failed: new Date().toISOString()
                }, supabase);
            } else {
                await updateUserSubscription(supabaseUserId, {
                    status: 'past_due',
                    last_payment_failed: new Date().toISOString()
                }, supabase);
            }
        }

    } catch (error) {
        console.error('Error handling payment failed:', error);
    }
}

// Handle trial ending warning
async function handleTrialWillEnd(subscription, stripe, supabase) {
    try {
        console.log('Trial will end for subscription:', subscription.id);

        const supabaseUserId = subscription.metadata?.supabase_user_id;
        
        if (!supabaseUserId) {
            // Try to get user ID from customer metadata
            const customer = await stripe.customers.retrieve(subscription.customer);
            const customerUserId = customer.metadata?.supabase_user_id;
            
            if (!customerUserId) {
                console.error('No Supabase user ID found for trial ending');
                return;
            }
            
            await updateUserSubscription(customerUserId, {
                trial_ending_notification_sent: new Date().toISOString()
            }, supabase);
        } else {
            await updateUserSubscription(supabaseUserId, {
                trial_ending_notification_sent: new Date().toISOString()
            }, supabase);
        }

        // Here you could send an email notification to the user
        console.log(`Trial ending notification should be sent to user ${supabaseUserId || 'unknown'}`);

    } catch (error) {
        console.error('Error handling trial will end:', error);
    }
}

// Helper function to update user subscription in Supabase
async function updateUserSubscription(supabaseUserId, subscriptionData, supabase) {
    try {
        console.log('Updating subscription for user:', supabaseUserId, subscriptionData);

        const { data, error } = await supabase
            .from('user_subscriptions')
            .upsert({
                supabase_user_id: supabaseUserId,
                ...subscriptionData,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'supabase_user_id'
            });

        if (error) {
            console.error('Supabase update error:', error);
            throw error;
        }

        console.log('Subscription updated successfully:', data);
        return data;

    } catch (error) {
        console.error('Error updating user subscription:', error);
        throw error;
    }
}