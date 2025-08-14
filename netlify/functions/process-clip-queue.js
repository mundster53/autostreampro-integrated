// netlify/functions/process-clip-queue.js
const ClipService = require('../../src/services/clip-service');

exports.handler = async (event, context) => {
    console.log('Processing clip queue...');
    
    try {
        const clipService = new ClipService();
        const result = await clipService.processQueue();
        
        console.log(`Processed ${result.processed} clips`);
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                processed: result.processed,
                timestamp: new Date().toISOString()
            })
        };
    } catch (error) {
        console.error('Queue processing failed:', error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};