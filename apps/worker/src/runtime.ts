export interface WorkerRuntimeSummary {
  queueMode: 'memory' | 'redis';
  queueDurable: boolean;
  managedRuntime: boolean;
  nodeEnv: 'development' | 'test' | 'production';
  twilioConfigured: boolean;
  issues: Array<{ code: string; severity: 'critical' | 'warning'; message: string }>;
}

export function buildWorkerRuntimeSummary(args: {
  nodeEnv: 'development' | 'test' | 'production';
  queueMode: 'memory' | 'redis';
  managedRuntime: boolean;
  twilioConfigured: boolean;
}): WorkerRuntimeSummary {
  const issues: WorkerRuntimeSummary['issues'] = [];

  if (args.nodeEnv === 'production' && args.queueMode !== 'redis') {
    issues.push({
      code: 'inmemory-queue',
      severity: 'critical',
      message: 'Production worker cannot run with an in-memory queue.',
    });
  }

  if (args.managedRuntime && args.nodeEnv !== 'production') {
    issues.push({
      code: 'managed-runtime-nonprod',
      severity: 'critical',
      message: 'Managed worker runtime is not using NODE_ENV=production.',
    });
  }

  if (!args.twilioConfigured) {
    issues.push({
      code: 'twilio-not-configured',
      severity: 'warning',
      message: 'Twilio messaging credentials are missing or test-only, so SMS retries are simulated.',
    });
  }

  return {
    queueMode: args.queueMode,
    queueDurable: args.queueMode === 'redis',
    managedRuntime: args.managedRuntime,
    nodeEnv: args.nodeEnv,
    twilioConfigured: args.twilioConfigured,
    issues,
  };
}
