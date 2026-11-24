process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.INTEGRATION_LOG_LEVEL ?? 'silent';
// Short interval so the scheduler is observable within the test timeout.
process.env.WORKER_HEARTBEAT_INTERVAL_SECONDS = '1';
