// Self-contained demo features - doesn't touch existing code
(function() {
    // Initialize Supabase if not already done
    const supabaseUrl = 'https://dykxhmdozgccawkbxejd.supabase.co'; // Replace with your URL
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5a3hobWRvemdjY2F3a2J4ZWpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwNTY2NTUsImV4cCI6MjA2NTYzMjY1NX0.SFxWx_Gk2ReRZCNpmAhKJ0jEeANjqeDLtQuU_MnGTlg'; // Replace with your key
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

    // Activity Feed Functions
    async function loadActivities() {
        try {
            const { data, error } = await supabase
                .from('clip_activities')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(10);
            
            const activityList = document.getElementById('activityList');
            
            if (error || !data || data.length === 0) {
                activityList.innerHTML = '<p>No recent activity</p>';
                return;
            }
            
            activityList.innerHTML = data.map(activity => `
                <div class="feed-item">
                    <span>${new Date(activity.created_at).toLocaleTimeString()}</span>
                    <span>${activity.action}</span>
                    ${activity.score ? `<span>Score: ${activity.score}%</span>` : ''}
                </div>
            `).join('');
        } catch (err) {
            console.error('Error loading activities:', err);
            document.getElementById('activityList').innerHTML = '<p>Error loading activities</p>';
        }
    }

    // Processing Queue Functions
    async function loadQueue() {
        try {
            const { data, error } = await supabase
                .from('clips')
                .select('*')
                .in('status', ['processing', 'scheduled', 'ready'])
                .order('created_at', { ascending: false })
                .limit(5);
            
            const queueList = document.getElementById('queueList');
            
            if (error || !data || data.length === 0) {
                queueList.innerHTML = '<p>No clips in queue</p>';
                return;
            }
            
            queueList.innerHTML = data.map(clip => {
                let icon = '';
                if (clip.status === 'processing') icon = '🔄';
                if (clip.status === 'scheduled') icon = '⏰';
                if (clip.status === 'ready') icon = '✅';
                
                return `
                    <div class="queue-item ${clip.status}">
                        ${icon}
                        <span>${clip.title || 'Untitled Clip'}</span>
                        <span>${clip.status}</span>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('Error loading queue:', err);
            document.getElementById('queueList').innerHTML = '<p>Error loading queue</p>';
        }
    }

      // Manual process trigger
    window.processNextClip = async function() {
        // DEMO MODE - Shows the full flow for TikTok
        const activityList = document.getElementById('activityList');
        
        // Clear and start fresh
        activityList.innerHTML = '<div class="feed-item">🔄 Processing clip: "Epic Gaming Moment"</div>';
        
        setTimeout(() => {
            activityList.innerHTML += '<div class="feed-item">🤖 AI Score: 85% - Above viral threshold!</div>';
        }, 1000);
        
        setTimeout(() => {
            activityList.innerHTML += '<div class="feed-item">📝 Generated: "INSANE Clutch Victory! 🔥 #gaming #viral"</div>';
        }, 2000);
        
        setTimeout(() => {
            activityList.innerHTML += `
                <div class="feed-item">✅ Posted to TikTok successfully!</div>
                <div class="feed-item">📱 View on TikTok: <a href="#" onclick="alert('Would open TikTok post')">tiktok.com/@user/video/123</a></div>
            `;
        }, 3000);
    }

    // Initialize when loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        loadActivities();
        loadQueue();
        
        // Refresh periodically
        setInterval(loadActivities, 30000);
        setInterval(loadQueue, 10000);
    }
})();
