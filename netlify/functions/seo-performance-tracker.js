// netlify/functions/seo-performance-tracker.js
// Tracks what's working and makes the system smarter

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
    console.log('SEO Performance Tracker running...');
    
    try {
        // Get clips that have been live for at least 24 hours
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        
        const { data: clips, error } = await supabase
            .from('clips')
            .select(`
                *,
                seo_performance(*)
            `)
            .eq('seo_optimized', true)
            .lte('published_at', oneDayAgo.toISOString())
            .is('seo_performance.views_hour_24', null); // Not yet analyzed
        
        if (error) throw error;
        
        console.log(`Found ${clips?.length || 0} clips to analyze`);
        
        for (const clip of clips || []) {
            await analyzeClipPerformance(clip);
        }
        
        // Learn from all recent performance data
        await updateLearningSystem();
        
        // Optimize underperforming games
        await optimizeStruggling();
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                analyzed: clips?.length || 0,
                message: 'Performance tracking complete'
            })
        };
        
    } catch (error) {
        console.error('Performance tracker error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

// Analyze individual clip performance
async function analyzeClipPerformance(clip) {
    try {
        // Simulate getting view data (in production, this would come from YouTube/TikTok APIs)
        const viewData = await getViewData(clip);
        
        // Record performance metrics
        const performanceData = {
            clip_id: clip.id,
            user_id: clip.user_id,
            game_name: clip.game_name,
            
            // Store what we tried
            optimized_title: clip.viral_title,
            optimized_description: clip.viral_description,
            hashtags_used: clip.hashtags,
            
            // Store results (simulated for now)
            views_hour_1: viewData.hour1 || Math.floor(Math.random() * 50),
            views_hour_24: viewData.hour24 || Math.floor(Math.random() * 500),
            views_day_7: viewData.day7 || Math.floor(Math.random() * 2000),
            
            engagement_rate: viewData.engagement || Math.random() * 0.1,
            click_through_rate: viewData.ctr || Math.random() * 0.05,
            
            // What worked?
            winning_factors: determineWinningFactors(clip, viewData),
            seo_strategy_used: clip.competition_level === 'low' ? 'aggressive' : 
                              clip.competition_level === 'high' ? 'specific' : 'balanced',
            
            posted_at: clip.published_at,
            measured_at: new Date()
        };
        
        // Save or update performance data
        const { error } = await supabase
            .from('seo_performance')
            .upsert(performanceData, {
                onConflict: 'clip_id'
            });
        
        if (error) throw error;
        
        // Update the clip's SEO score based on performance
        const seoScore = calculatePerformanceScore(viewData);
        await supabase
            .from('clips')
            .update({ seo_score: seoScore })
            .eq('id', clip.id);
        
        console.log(`Analyzed clip ${clip.id}: ${viewData.hour24} views in 24h`);
        
    } catch (error) {
        console.error(`Error analyzing clip ${clip.id}:`, error);
    }
}

// Get view data (simulated - replace with actual API calls)
async function getViewData(clip) {
    // In production, this would call YouTube/TikTok APIs
    // For now, simulate based on SEO quality
    
    const baseViews = clip.ai_score * 1000;
    const seoMultiplier = clip.seo_optimized ? 3 : 1;
    const competitionPenalty = 
        clip.competition_level === 'high' ? 0.5 :
        clip.competition_level === 'low' ? 2 : 1;
    
    return {
        hour1: Math.floor(baseViews * 0.1 * seoMultiplier * competitionPenalty),
        hour24: Math.floor(baseViews * seoMultiplier * competitionPenalty),
        day7: Math.floor(baseViews * 5 * seoMultiplier * competitionPenalty),
        engagement: Math.random() * 0.1,
        ctr: Math.random() * 0.05
    };
}

// Determine what SEO factors worked
function determineWinningFactors(clip, viewData) {
    const factors = {};
    
    // Title effectiveness
    if (clip.viral_title?.includes('🔥') && viewData.hour1 > 50) {
        factors.emoji_in_title = true;
    }
    if (clip.viral_title?.length >= 50 && clip.viral_title?.length <= 70) {
        factors.optimal_title_length = true;
    }
    
    // Hashtag effectiveness
    if (clip.hashtags?.length >= 5 && clip.hashtags?.length <= 10) {
        factors.good_hashtag_count = true;
    }
    
    // Timing effectiveness
    const postHour = new Date(clip.published_at).getHours();
    if ([14, 17, 20].includes(postHour) && viewData.hour1 > 30) {
        factors.optimal_timing = true;
    }
    
    return factors;
}

// Calculate performance score
function calculatePerformanceScore(viewData) {
    let score = 0;
    
    // Views contribute 60%
    if (viewData.hour24 > 1000) score += 0.3;
    else if (viewData.hour24 > 500) score += 0.2;
    else if (viewData.hour24 > 100) score += 0.1;
    
    if (viewData.day7 > 5000) score += 0.3;
    else if (viewData.day7 > 2000) score += 0.2;
    else if (viewData.day7 > 500) score += 0.1;
    
    // Engagement contributes 40%
    score += Math.min(viewData.engagement * 4, 0.4);
    
    return Math.min(score, 1);
}

// Update the learning system with new insights
async function updateLearningSystem() {
    try {
        // Get recent performance data
        const { data: recentPerformance } = await supabase
            .from('seo_performance')
            .select('*')
            .gte('measured_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)); // Last 7 days
        
        if (!recentPerformance?.length) return;
        
        // Group by game to learn game-specific patterns
        const gamePatterns = {};
        
        for (const perf of recentPerformance) {
            if (!gamePatterns[perf.game_name]) {
                gamePatterns[perf.game_name] = {
                    total_views: 0,
                    successful_titles: [],
                    successful_hashtags: [],
                    best_times: [],
                    count: 0
                };
            }
            
            const game = gamePatterns[perf.game_name];
            game.total_views += perf.views_hour_24 || 0;
            game.count++;
            
            // Track successful elements
            if (perf.views_hour_24 > 500) {
                game.successful_titles.push(perf.optimized_title);
                game.successful_hashtags.push(...(perf.hashtags_used || []));
                
                const postHour = new Date(perf.posted_at).getHours();
                game.best_times.push(postHour);
            }
        }
        
        // Update learning database for each game
        for (const [gameName, patterns] of Object.entries(gamePatterns)) {
            const avgViews = patterns.total_views / patterns.count;
            
            // Extract most common successful patterns
            const bestHashtags = getMostFrequent(patterns.successful_hashtags, 10);
            const bestTimes = getMostFrequent(patterns.best_times, 3);
            const titleWords = extractCommonWords(patterns.successful_titles);
            
            // Update or create learning record
            await supabase
                .from('seo_performance_learning')
                .upsert({
                    game_name: gameName,
                    winning_keywords: titleWords,
                    best_hashtags: bestHashtags,
                    best_posting_hours: bestTimes,
                    avg_day_1_views: Math.floor(avgViews),
                    last_updated: new Date()
                }, {
                    onConflict: 'game_name'
                });
            
            console.log(`Updated learning for ${gameName}: Avg views ${avgViews}`);
        }
        
        // Update template success rates
        await updateTemplateSuccessRates(recentPerformance);
        
    } catch (error) {
        console.error('Learning system error:', error);
    }
}

// Update template success rates based on performance
async function updateTemplateSuccessRates(performanceData) {
    const templatePerformance = {};
    
    for (const perf of performanceData) {
        // Identify which template was likely used based on title pattern
        const templateType = identifyTemplateType(perf.optimized_title);
        
        if (!templatePerformance[templateType]) {
            templatePerformance[templateType] = {
                total_views: 0,
                count: 0
            };
        }
        
        templatePerformance[templateType].total_views += perf.views_hour_24 || 0;
        templatePerformance[templateType].count++;
    }
    
    // Update template success rates
    for (const [type, data] of Object.entries(templatePerformance)) {
        const avgViews = data.total_views / data.count;
        const successRate = Math.min(avgViews / 1000, 0.95); // Cap at 95%
        
        await supabase
            .from('universal_seo_templates')
            .update({
                success_rate: successRate,
                avg_view_count: Math.floor(avgViews),
                times_used: data.count
            })
            .eq('content_type', type);
    }
}

// Identify which template type was used
function identifyTemplateType(title) {
    if (!title) return 'highlight';
    
    const lower = title.toLowerCase();
    if (lower.includes('win') || lower.includes('victory')) return 'win';
    if (lower.includes('kill') || lower.includes('elim')) return 'kill';
    if (lower.includes('fail') || lower.includes('funny')) return 'fail';
    if (lower.includes('guide') || lower.includes('how to')) return 'tutorial';
    if (lower.includes('secret') || lower.includes('found')) return 'discovery';
    if (lower.includes('clutch') || lower.includes('1v')) return 'clutch';
    
    return 'highlight';
}

// Optimize struggling games/channels
async function optimizeStruggling() {
    try {
        // Find games with poor performance
        const { data: strugglingGames } = await supabase
            .from('seo_performance_learning')
            .select('*')
            .lt('avg_day_1_views', 100); // Less than 100 views average
        
        for (const game of strugglingGames || []) {
            console.log(`Optimizing strategy for struggling game: ${game.game_name}`);
            
            // Adjust competition level
            await supabase
                .from('game_intelligence')
                .update({
                    competition_score: Math.max(0.1, (game.competition_score || 0.5) - 0.1),
                    competition_trend: 'decreasing'
                })
                .eq('game_name', game.game_name);
            
            // Mark for strategy change
            await supabase
                .from('channel_seo_profiles')
                .update({
                    content_style: 'tutorial', // Switch to educational content
                    optimization_level: 'advanced'
                })
                .eq('primary_game', game.game_name);
        }
        
    } catch (error) {
        console.error('Optimization error:', error);
    }
}

// Helper: Get most frequent items from array
function getMostFrequent(arr, count) {
    const frequency = {};
    arr.forEach(item => {
        frequency[item] = (frequency[item] || 0) + 1;
    });
    
    return Object.entries(frequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([item]) => item);
}

// Helper: Extract common words from titles
function extractCommonWords(titles) {
    const words = {};
    const stopWords = ['the', 'a', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    
    titles.forEach(title => {
        if (!title) return;
        
        title.split(/\s+/).forEach(word => {
            const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (clean && !stopWords.includes(clean) && clean.length > 2) {
                words[clean] = (words[clean] || 0) + 1;
            }
        });
    });
    
    return Object.entries(words)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word]) => word);
}