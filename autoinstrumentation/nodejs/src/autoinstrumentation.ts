import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { awsEc2Detector, awsEksDetector, } from '@opentelemetry/resource-detector-aws';
import { containerDetector } from '@opentelemetry/resource-detector-container';
import { envDetector, hostDetector, osDetector, processDetector, } from '@opentelemetry/resources';
import { diag, Span } from '@opentelemetry/api';

import { ExpressInstrumentation, ExpressLayerType, } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { MySQL2Instrumentation } from '@opentelemetry/instrumentation-mysql2';
import { SocketIoInstrumentation } from '@opentelemetry/instrumentation-socket.io';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { RedisInstrumentation as Redis4Instrumentation } from '@opentelemetry/instrumentation-redis-4';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

import { NodeSDK } from '@opentelemetry/sdk-node';

const { WinstonInstrumentation } = require('@opentelemetry/instrumentation-winston');

function handleResponse(span: Span, conn: any, key: string): void {
  span.setAttribute(`${key}.headers`, JSON.stringify(conn.headers));
  conn.on('data', (chunk: Buffer) => {
    if (!conn['myBody']) {
      conn['myBody'] = '';
    }
    conn['myBody'] += chunk?.toString();
  });
  conn.on('end', () => {
    span.setAttribute(`${key}.body`, conn['myBody']?.slice(0, 3000));
  });
}

function getMetricReader() {
  switch (process.env.OTEL_METRICS_EXPORTER) {
    case undefined:
    case '':
    case 'otlp':
      diag.info('using otel metrics exporter');
      return new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
      });
    case 'prometheus':
      diag.info('using prometheus metrics exporter');
      return new PrometheusExporter({});
    case 'none':
      diag.info('disabling metrics reader');
      return undefined;
    default:
      throw Error(
        `no valid option for OTEL_METRICS_EXPORTER: ${process.env.OTEL_METRICS_EXPORTER}`,
      );
  }
}

const sdk = new NodeSDK({
  autoDetectResources: true,
  instrumentations: [
    new NestInstrumentation(),
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request: any) => {
        if (request.url === '/' || request.url === '/metrics') {
          return true;
        }
        return request.method?.toLowerCase() === 'options';
      },
      applyCustomAttributesOnSpan: (span, request, response) => {
      },
      requestHook: (span, request: any) => {
        handleResponse(span, request, 'http.request');
      },
      responseHook: (span, response: any) => {
        handleResponse(span, response, 'http.response');
      },
    }),
    new ExpressInstrumentation({
      ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.REQUEST_HANDLER],
    }),
    new MySQL2Instrumentation(),
    new SocketIoInstrumentation(),
    new RedisInstrumentation(),
    new Redis4Instrumentation(),
    new IORedisInstrumentation(),
    new WinstonInstrumentation({ }),
  ],
  traceExporter: new OTLPTraceExporter(),
  metricReader: getMetricReader(),
  resourceDetectors: [
    // Standard resource detectors.
    containerDetector,
    envDetector,
    hostDetector,
    osDetector,
    processDetector,
    // Ordered AWS Resource Detectors as per:
    // https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/resourcedetectionprocessor/README.md#ordering
    awsEksDetector,
    awsEc2Detector,
  ],
});

sdk.start();
