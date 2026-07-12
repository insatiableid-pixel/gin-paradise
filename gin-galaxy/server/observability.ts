import crypto from "crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";

import { logger } from "./logger.js";

const uuidPattern =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;

const metrics = {
  startedAt: Date.now(),
  requestsTotal: 0,
  errorsTotal: 0,
  inflight: 0,
  durationMsTotal: 0,
  durationMsMax: 0,
  byRoute: new Map<string, number>(),
  coordinatorCommitsTotal: 0,
  coordinatorCommitFailuresTotal: 0,
  coordinatorCommitDurationMsTotal: 0,
  coordinatorCommitDurationMsMax: 0,
};

interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

function getRequestId(headerValue: string | string[] | undefined) {
  if (Array.isArray(headerValue)) return headerValue[0] ?? crypto.randomUUID();
  return headerValue || crypto.randomUUID();
}

function getHeaderValue(headerValue: string | string[] | undefined) {
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString("hex");
}

function getTraceContext(headerValue: string | string[] | undefined): TraceContext {
  const traceparent = getHeaderValue(headerValue);
  const match = traceparent?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);

  return {
    traceId: match?.[1]?.toLowerCase() ?? randomHex(16),
    spanId: randomHex(8),
    sampled: match ? (parseInt(match[3], 16) & 1) === 1 : true,
  };
}

function formatTraceparent(trace: TraceContext) {
  return `00-${trace.traceId}-${trace.spanId}-${trace.sampled ? "01" : "00"}`;
}

function normalizePath(path: string) {
  return path
    .split("?")[0]
    .replace(uuidPattern, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

function observeRequest(method: string, path: string, statusCode: number, durationMs: number) {
  const routeKey = `${method.toUpperCase()} ${normalizePath(path)}`;
  metrics.requestsTotal += 1;
  metrics.durationMsTotal += durationMs;
  metrics.durationMsMax = Math.max(metrics.durationMsMax, durationMs);
  metrics.byRoute.set(routeKey, (metrics.byRoute.get(routeKey) ?? 0) + 1);
  if (statusCode >= 500) metrics.errorsTotal += 1;
}

export function observeCoordinatorCommit(durationMs: number, succeeded: boolean): void {
  metrics.coordinatorCommitsTotal += 1;
  metrics.coordinatorCommitDurationMsTotal += durationMs;
  metrics.coordinatorCommitDurationMsMax = Math.max(
    metrics.coordinatorCommitDurationMsMax,
    durationMs,
  );
  if (!succeeded) metrics.coordinatorCommitFailuresTotal += 1;
}

function prometheusLine(name: string, value: number, help: string, type: "counter" | "gauge") {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`];
}

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = getRequestId(req.headers["x-request-id"]);
  const trace = getTraceContext(req.headers.traceparent);
  const startedAt = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.locals.traceId = trace.traceId;
  res.locals.spanId = trace.spanId;
  res.setHeader("x-request-id", requestId);
  res.setHeader("traceparent", formatTraceparent(trace));
  metrics.inflight += 1;

  res.on("finish", () => {
    metrics.inflight = Math.max(0, metrics.inflight - 1);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    observeRequest(req.method, req.originalUrl, res.statusCode, durationMs);

    logger.info("request.completed", {
      requestId,
      traceId: trace.traceId,
      spanId: trace.spanId,
      method: req.method,
      path: normalizePath(req.originalUrl),
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
  });

  next();
};

export const metricsHandler: RequestHandler = (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startedAt) / 1000);
  const averageDurationMs =
    metrics.requestsTotal > 0 ? metrics.durationMsTotal / metrics.requestsTotal : 0;
  const averageCoordinatorCommitDurationMs = metrics.coordinatorCommitsTotal > 0
    ? metrics.coordinatorCommitDurationMsTotal / metrics.coordinatorCommitsTotal
    : 0;
  const lines = [
    ...prometheusLine(
      "gin_paradise_uptime_seconds",
      uptimeSeconds,
      "Application uptime in seconds.",
      "gauge",
    ),
    ...prometheusLine(
      "gin_paradise_requests_total",
      metrics.requestsTotal,
      "Total HTTP requests.",
      "counter",
    ),
    ...prometheusLine(
      "gin_paradise_errors_total",
      metrics.errorsTotal,
      "Total HTTP 5xx responses.",
      "counter",
    ),
    ...prometheusLine(
      "gin_paradise_inflight_requests",
      metrics.inflight,
      "HTTP requests currently in flight.",
      "gauge",
    ),
    ...prometheusLine(
      "gin_paradise_request_duration_ms_avg",
      averageDurationMs,
      "Average HTTP request duration in milliseconds.",
      "gauge",
    ),
    ...prometheusLine(
      "gin_paradise_request_duration_ms_max",
      metrics.durationMsMax,
      "Maximum HTTP request duration in milliseconds.",
      "gauge",
    ),
    ...prometheusLine(
      "gin_paradise_coordinator_commits_total",
      metrics.coordinatorCommitsTotal,
      "Durable multiplayer coordinator commits.",
      "counter",
    ),
    ...prometheusLine(
      "gin_paradise_coordinator_commit_failures_total",
      metrics.coordinatorCommitFailuresTotal,
      "Failed durable multiplayer coordinator commits.",
      "counter",
    ),
    ...prometheusLine(
      "gin_paradise_coordinator_commit_duration_ms_avg",
      averageCoordinatorCommitDurationMs,
      "Average durable coordinator commit latency in milliseconds.",
      "gauge",
    ),
    ...prometheusLine(
      "gin_paradise_coordinator_commit_duration_ms_max",
      metrics.coordinatorCommitDurationMsMax,
      "Maximum durable coordinator commit latency in milliseconds.",
      "gauge",
    ),
    "# HELP gin_paradise_route_requests_total Total HTTP requests by normalized route.",
    "# TYPE gin_paradise_route_requests_total counter",
    ...Array.from(metrics.byRoute.entries()).map(([route, count]) => {
      const [method, ...pathParts] = route.split(" ");
      const path = pathParts.join(" ");
      return `gin_paradise_route_requests_total{method="${method}",path="${path}"} ${count}`;
    }),
  ];

  res.type("text/plain; version=0.0.4").send(`${lines.join("\n")}\n`);
};

export const apiNotFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: "not_found",
    path: req.originalUrl,
    requestId: res.locals.requestId,
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const statusCode = typeof err?.status === "number" && err.status >= 400 ? err.status : 500;
  logger.error("request.failed", {
    requestId: res.locals.requestId,
    traceId: res.locals.traceId,
    method: req.method,
    path: normalizePath(req.originalUrl),
    statusCode,
    error: err,
  });

  res.status(statusCode).json({
    error: statusCode >= 500 ? "internal_server_error" : "request_error",
    requestId: res.locals.requestId,
    traceId: res.locals.traceId,
  });
};
