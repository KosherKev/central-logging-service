const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

/**
 * LogShipper - Client library for shipping logs to Central Logging Service
 * 
 * Usage:
 * const LogShipper = require('./log-shipper');
 * const logger = new LogShipper({
 *   serviceUrl: 'https://your-logging-service.run.app',
 *   apiKey: 'your-api-key',
 *   serviceName: 'user-api'
 * });
 * 
 * logger.log({ level: 'info', message: 'User logged in', ... });
 */
class LogShipper {
  constructor(options = {}) {
    this.serviceUrl = options.serviceUrl || 'http://localhost:8080';
    this.apiKey = options.apiKey;
    this.serviceName = options.serviceName || 'unknown-service';
    this.batchSize = options.batchSize || 50;
    this.flushInterval = options.flushInterval || 5000; // 5 seconds
    this.enabled = options.enabled !== false;
    
    this.buffer = [];
    this.timer = null;
    this.flushing = false;
    
    if (!this.apiKey) {
      console.warn('⚠️  LogShipper: No API key provided. Logging will fail.');
    }
    
    // Start flush timer
    this.startFlushTimer();
    
    // Flush on process exit
    process.on('beforeExit', () => this.flush());
    process.on('SIGINT', () => this.flush().then(() => process.exit(0)));
    process.on('SIGTERM', () => this.flush().then(() => process.exit(0)));
  }
  
  /**
   * Log an entry
   * @param {Object} entry - Log entry object
   */
  log(entry) {
    if (!this.enabled) return;
    
    const logEntry = {
      timestamp: entry.timestamp || new Date().toISOString(),
      level: entry.level || 'info',
      service: this.serviceName,
      traceId: entry.traceId || uuidv4(),
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      duration: entry.duration,
      request: entry.request,
      response: entry.response,
      error: entry.error,
      metadata: entry.metadata || {}
    };
    
    this.buffer.push(logEntry);
    
    // Flush if batch size reached
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }
  
  /**
   * Convenience methods for different log levels
   */
  info(data) {
    this.log({ ...data, level: 'info' });
  }
  
  warn(data) {
    this.log({ ...data, level: 'warn' });
  }
  
  error(data) {
    this.log({ ...data, level: 'error' });
  }
  
  debug(data) {
    this.log({ ...data, level: 'debug' });
  }
  
  /**
   * Flush buffer to logging service
   */
  async flush() {
    if (this.buffer.length === 0 || this.flushing) {
      return;
    }
    
    this.flushing = true;
    const logs = [...this.buffer];
    this.buffer = [];
    
    try {
      const response = await fetch(`${this.serviceUrl}/api/v1/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({ logs }),
        timeout: 10000
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to ship logs: ${response.status} - ${error}`);
      }
      
      const result = await response.json();
      console.log(`✅ LogShipper: Shipped ${result.count} logs`);
      
    } catch (error) {
      console.error('❌ LogShipper: Failed to ship logs:', error.message);
      
      // On failure, put logs back in buffer to retry
      this.buffer.unshift(...logs);
      
      // Limit buffer size to prevent memory issues
      if (this.buffer.length > 10000) {
        console.warn('⚠️  LogShipper: Buffer overflow, dropping oldest logs');
        this.buffer = this.buffer.slice(-10000);
      }
    } finally {
      this.flushing = false;
    }
  }
  
  /**
   * Start periodic flush timer
   */
  startFlushTimer() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
    
    // Don't keep process alive just for this timer
    if (this.timer.unref) {
      this.timer.unref();
    }
  }
  
  /**
   * Stop the flush timer
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.flush();
  }
  
  /**
   * Express middleware for automatic request/response logging
   */
  middleware() {
    return (req, res, next) => {
      const start = Date.now();
      const traceId = req.headers['x-trace-id'] || uuidv4();
      
      // Add trace ID to request for use in other middleware
      req.traceId = traceId;
      
      // Capture response
      const originalSend = res.send;
      let responseBody;
      
      res.send = function(data) {
        responseBody = data;
        originalSend.call(this, data);
      };
      
      // Log when response finishes
      res.on('finish', () => {
        const duration = Date.now() - start;
        
        // Determine log level based on status code
        let level = 'info';
        if (res.statusCode >= 500) level = 'error';
        else if (res.statusCode >= 400) level = 'warn';
        
        this.log({
          level,
          traceId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          request: {
            headers: req.headers,
            body: req.body,
            query: req.query,
            ip: req.ip,
            userAgent: req.get('user-agent')
          },
          response: {
            body: responseBody
          },
          metadata: {
            url: req.originalUrl,
            protocol: req.protocol,
            hostname: req.hostname
          }
        });
      });
      
      next();
    };
  }
}

module.exports = LogShipper;
