process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.INTEGRATION_LOG_LEVEL ?? 'silent';
// Short interval so the scheduler is observable within the test timeout.
process.env.WORKER_HEARTBEAT_INTERVAL_SECONDS = '1';
process.env.DEV_TOOLS_ENABLED = 'true';
// The integration test starts its own SMTP server on this port.
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '2525';
process.env.SMTP_USER = '';
process.env.SMTP_PASSWORD = '';
