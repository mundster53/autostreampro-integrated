// Stripe Checkout Handler for AutoStreamPro Trial Signup with Supabase
const Stripe = require('stripe');

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
        // Initialize Stripe
        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        
        // Parse request body
        const { plan, userEmail, userId, userName } = JSON.parse(event.body);
        
        // Validate required fields
        if (!plan || !userEmail || !userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Missing required fields: plan, userEmail, userId' 
                })
            };
        }

        // Define plan pricing
        const planPricing = {
            'starter': {
                amount: 2500, // $25.00 in cents
                name: 'AutoStreamPro Starter',
                description: 'Perfect for new streamers just getting started'
            },
            'expert': {
                amount: 4500, // $45.00 in cents
                name: 'AutoStreamPro Expert',
                description: 'For expert streamers looking to grow'
            },
            'pro': {
                amount: 7000, // $70.00 in cents
                name: 'AutoStreamPro Pro',
                description: 'For pro streamers making more than $1,000/month'
            }
        };

        // Validate plan
        if (!planPricing[plan]) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid plan selected' 
                })
            };
        }

        const selectedPlan = planPricing[plan];

        // Check if customer already exists
        let customer;
        const existingCustomers = await stripe.customers.list({
            email: userEmail,
            limit: 1
        });

        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            
            // Update customer metadata with Supabase user ID
            await stripe.customers.update(customer.id, {
                metadata: {
                    supabase_user_id: userId,
                    plan: plan
                }
            });
        } else {
            // Create new customer
            customer = await stripe.customers.create({
                email: userEmail,
                name: userName || userEmail,
                metadata: {
                    supabase_user_id: userId,
                    plan: plan
                }
            });
        }

        // Check if product exists, create if not
        let product;
        const existingProducts = await stripe.products.list({
            limit: 100
        });
        
        const existingProduct = existingProducts.data.find(p => 
            p.name === selectedPlan.name
        );

        if (existingProduct) {
            product = existingProduct;
        } else {
            product = await stripe.products.create({
                name: selectedPlan.name,
                description: selectedPlan.description,
                metadata: {
                    plan_type: plan
                }
            });
        }

        // Check if price exists, create if not
        let price;
        const existingPrices = await stripe.prices.list({
            product: product.id,
            limit: 100
        });

        const existingPrice = existingPrices.data.find(p => 
            p.unit_amount === selectedPlan.amount && 
            p.currency === 'usd' && 
            p.recurring?.interval === 'month'
        );

        if (existingPrice) {
            price = existingPrice;
        } else {
            price = await stripe.prices.create({
                product: product.id,
                unit_amount: selectedPlan.amount,
                currency: 'usd',
                recurring: {
                    interval: 'month'
                },
                metadata: {
                    plan_type: plan
                }
            });
        }

        // Create checkout session with 14-day trial
        const session = await stripe.checkout.sessions.create({
            customer: customer.id,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: price.id,
                    quantity: 1,
                }
            ],
            mode: 'subscription',
            
            // 14-day trial period
            subscription_data: {
                trial_period_days: 14,
                metadata: {
                    supabase_user_id: userId,
                    plan: plan
                }
            },
            
            // URLs
            success_url: `${process.env.SITE_URL}/onboarding-wizard.html?session_id={CHECKOUT_SESSION_ID}&trial=true`,
            cancel_url: `${process.env.SITE_URL}/signup.html?plan=${plan}&cancelled=true`,
            
            // Metadata
            metadata: {
                supabase_user_id: userId,
                plan: plan,
                trial_signup: 'true'
            },

            // Additional options
            allow_promotion_codes: true,
            billing_address_collection: 'auto',
            
            // Custom success page
            custom_text: {
                submit: {
                    message: 'Start your 14-day free trial now!'
                }
            }
        });

        console.log(`Checkout session created for user ${userId}, plan: ${plan}, session: ${session.id}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                checkoutUrl: session.url,
                sessionId: session.id,
                customerId: customer.id,
                message: '14-day trial checkout session created successfully'
            })
        };

    } catch (error) {
        console.error('Stripe checkout error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to create checkout session',
                message: error.message,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};