const LogShipper = require('../client/log-shipper');

// Initialize logger
// Collector URL + key come from the environment (TELEMETRY_COLLECTOR_URL /
// TELEMETRY_API_KEY, or the legacy LOGGING_SERVICE_URL / LOGGING_API_KEY).
// Unset = logging is a no-op. Entries are redacted before shipping.
const logger = new LogShipper({ serviceName: 'batch-processor' });

// Simulate a batch processing job
async function processBatch(items) {
  const startTime = Date.now();
  const batchId = `batch-${Date.now()}`;
  
  logger.info({
    message: 'Batch processing started',
    metadata: {
      batchId,
      itemCount: items.length
    }
  });
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const item of items) {
    try {
      // Simulate processing
      await processItem(item);
      successCount++;
      
      logger.debug({
        message: 'Item processed',
        metadata: {
          batchId,
          itemId: item.id
        }
      });
    } catch (error) {
      errorCount++;
      
      logger.error({
        message: 'Item processing failed',
        error: {
          message: error.message,
          stack: error.stack
        },
        metadata: {
          batchId,
          itemId: item.id
        }
      });
    }
  }
  
  const duration = Date.now() - startTime;
  
  logger.info({
    message: 'Batch processing completed',
    metadata: {
      batchId,
      duration,
      successCount,
      errorCount,
      totalItems: items.length
    }
  });
  
  // Flush logs immediately for batch jobs
  await logger.flush();
  
  return { successCount, errorCount };
}

async function processItem(item) {
  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Simulate random failures
  if (Math.random() < 0.1) {
    throw new Error('Random processing error');
  }
  
  return item;
}

// Run example
(async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ 
    id: i + 1, 
    data: `Item ${i + 1}` 
  }));
  
  const result = await processBatch(items);
  
  console.log('Batch completed:', result);
  
  // Stop logger and flush remaining logs
  await logger.stop();
})();
