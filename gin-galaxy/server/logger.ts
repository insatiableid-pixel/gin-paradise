type LogLevel = "debug" | "info" | "warn" | "error";

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
const sensitiveKeyPattern = /(authorization|cookie|password|secret|token|api[-_]?key|session)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[Truncated]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, innerValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitiveKeyPattern.test(key) ? "[Redacted]" : redact(innerValue, depth + 1);
  }
  return output;
}

function shouldLog(level: LogLevel) {
  const activeLevel = levelWeight[configuredLevel] ? configuredLevel : "info";
  return levelWeight[level] >= levelWeight[activeLevel];
}

function write(level: LogLevel, message: string, context: Record<string, unknown> = {}) {
  if (!shouldLog(level)) return;

  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(redact(context) as Record<string, unknown>),
  };
  const line = JSON.stringify(record);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};
