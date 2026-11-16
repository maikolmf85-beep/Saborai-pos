export type GraphApiErrorClass =
  | 'unsupported_parameter'
  | 'invalid_parameter_value'
  | 'missing_required_parameter'
  | 'template_message_required'
  | 'unsupported_request'
  | 'object_unavailable_or_unsupported'
  | 'unclassified';

export type SafeGraphApiError = {
  code?: number;
  subcode?: number;
  messageClass?: GraphApiErrorClass;
  detailsClass?: GraphApiErrorClass;
  parameters?: string[];
};

const GRAPH_API_ERROR_TEXT_ALLOWLIST = new Map<string, GraphApiErrorClass>([
  ['the request included one or more unsupported or misspelled parameters.', 'unsupported_parameter'],
  ['one or more parameter values are invalid.', 'invalid_parameter_value'],
  ['the request is missing a required parameter.', 'missing_required_parameter'],
  ['message must be a template message.', 'template_message_required'],
  ['unsupported post request', 'unsupported_request'],
  ['unsupported post request.', 'unsupported_request'],
  ['invalid parameter', 'invalid_parameter_value'],
  ['invalid parameter.', 'invalid_parameter_value']
]);

const GRAPH_API_ERROR_TEXT_PATTERNS: Array<[RegExp, GraphApiErrorClass]> = [
  [/^(?:\(#\d+\)\s*)?invalid parameter(?: value)?\.?$/, 'invalid_parameter_value'],
  [/^(?:\(#\d+\)\s*)?unsupported post request\.?$/, 'unsupported_request'],
  [/^(?:unsupported post request\.\s*)?object with id ['"][a-z0-9._:+-]{1,128}['"] does not exist, cannot be loaded due to missing permissions, or does not support this operation\.?$/, 'object_unavailable_or_unsupported']
];

// Parameter names are taken from Meta's official Messages API and Messaging Accounts references.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
// https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/
const GRAPH_API_PARAMETER_NAMES = new Set([
  'action', 'address', 'audio', 'body', 'button', 'buttons',
  'caption', 'code', 'components', 'context', 'description', 'document',
  'flow_action', 'flow_action_payload', 'flow_id', 'flow_message_version', 'flow_token',
  'footer', 'header', 'image', 'interactive', 'language', 'latitude', 'link', 'location',
  'longitude', 'media', 'messaging_account_id', 'messaging_product', 'name', 'parameters',
  'preview_url', 'product_retailer_id', 'recipient_type', 'rows', 'sections', 'status',
  'sticker', 'template', 'text', 'title', 'to', 'type', 'video'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequiredGraphApiParameter(value: string): string | undefined {
  const match = value.replace(/^\(#\d+\)\s*/i, '').match(/\b(?:the\s+)?(?:parameter|param|field)\s+["']?([a-z][a-z0-9_]{0,63})["']?\s+is\s+required\b/i);
  return match?.[1].toLowerCase();
}

function classifyGraphApiErrorText(value: unknown): GraphApiErrorClass | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length > 512) return 'unclassified';
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return undefined;

  const exactClass = GRAPH_API_ERROR_TEXT_ALLOWLIST.get(normalized);
  if (exactClass) return exactClass;

  const requiredParameter = getRequiredGraphApiParameter(normalized);
  if (requiredParameter) {
    return GRAPH_API_PARAMETER_NAMES.has(requiredParameter) ? 'missing_required_parameter' : 'unclassified';
  }

  for (const [pattern, errorClass] of GRAPH_API_ERROR_TEXT_PATTERNS) {
    if (pattern.test(normalized)) return errorClass;
  }
  return 'unclassified';
}

function extractAllowlistedGraphParameters(values: unknown[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const parameter of GRAPH_API_PARAMETER_NAMES) {
      const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matcher = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i');
      if (matcher.test(value)) found.add(parameter);
    }
  }
  return [...found].sort();
}

export function extractSafeGraphApiError(payload: unknown): SafeGraphApiError {
  if (!isRecord(payload) || !isRecord(payload.error)) return {};
  const error = payload.error;
  const errorData = isRecord(error.error_data) ? error.error_data : undefined;
  const details = errorData?.details;
  const safeDetails: SafeGraphApiError = {};

  if (typeof error.code === 'number' && Number.isSafeInteger(error.code) && error.code >= 0) {
    safeDetails.code = error.code;
  }
  if (typeof error.error_subcode === 'number' && Number.isSafeInteger(error.error_subcode) && error.error_subcode >= 0) {
    safeDetails.subcode = error.error_subcode;
  }

  const messageClass = classifyGraphApiErrorText(error.message);
  const detailsClass = classifyGraphApiErrorText(details);
  if (messageClass) safeDetails.messageClass = messageClass;
  if (detailsClass) safeDetails.detailsClass = detailsClass;

  const parameters = extractAllowlistedGraphParameters([
    error.message,
    error.error_user_title,
    error.error_user_msg,
    details
  ]);
  if (parameters.length > 0) safeDetails.parameters = parameters;
  return safeDetails;
}

export type GeminiModelLabel = 'gemini-3.8-flash' | 'gemini-3.5-flash-lite' | 'not_attempted';

export type GeminiFailureTelemetry = {
  apiKeyPresent: boolean;
  model: GeminiModelLabel;
  httpStatus?: number;
  errorCode?: number | string;
  timedOut: boolean;
  timeoutMs: number;
  generationTimeoutMs: number;
  maxAttemptsPerModel: number;
  retryCount: number;
};

const GEMINI_ERROR_ALIASES = new Set([
  'aborted',
  'already_exists',
  'api_error',
  'authentication',
  'cancelled',
  'deadline_exceeded',
  'empty_response',
  'failed_precondition',
  'internal',
  'invalid_argument',
  'invalid_request',
  'model_not_found',
  'not_found',
  'out_of_range',
  'parameter_unknown',
  'payment_required',
  'permission_denied',
  'quota_exceeded',
  'rate_limit_exceeded',
  'resource_exhausted',
  'service_unavailable',
  'too_many_requests',
  'unauthenticated',
  'unavailable',
  'unimplemented'
]);

const GEMINI_NUMERIC_ERROR_CODES = new Set([400, 401, 402, 403, 404, 409, 416, 429, 499, 500, 501, 503, 504]);
const GEMINI_TIMEOUT_NAMES = new Set(['aborterror', 'timeouterror', 'timeoutexception']);
const GEMINI_TIMEOUT_CODES = new Set(['abort_err', 'etimedout']);

function getRecordProperty(record: Record<string, unknown>, key: string): unknown {
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function getGeminiErrorRecords(error: unknown): Record<string, unknown>[] {
  if (!isRecord(error)) return [];
  const records = [error];
  for (const key of ['error', 'cause', 'response']) {
    const nested = getRecordProperty(error, key);
    if (isRecord(nested)) records.push(nested);
  }
  return records;
}

function normalizeGeminiErrorAlias(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return GEMINI_ERROR_ALIASES.has(normalized) ? normalized : undefined;
}

function getSafeGeminiErrorCode(records: Record<string, unknown>[]): number | string | undefined {
  for (const record of records) {
    for (const key of ['code', 'status', 'statusCode']) {
      const value = getRecordProperty(record, key);
      if (typeof value === 'number' && Number.isSafeInteger(value) && GEMINI_NUMERIC_ERROR_CODES.has(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const alias = normalizeGeminiErrorAlias(value);
        if (alias) return alias;
      }
    }
  }
  return undefined;
}

function getSafeGeminiHttpStatus(records: Record<string, unknown>[]): number | undefined {
  for (const record of records) {
    for (const key of ['status', 'statusCode']) {
      const value = getRecordProperty(record, key);
      if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
        return value;
      }
    }
  }
  return undefined;
}

function isGeminiTimeout(records: Record<string, unknown>[], errorCode: number | string | undefined, httpStatus: number | undefined): boolean {
  if (errorCode === 'deadline_exceeded' || httpStatus === 408 || httpStatus === 504) return true;
  return records.some((record) => {
    const name = getRecordProperty(record, 'name');
    const code = getRecordProperty(record, 'code');
    return (typeof name === 'string' && GEMINI_TIMEOUT_NAMES.has(name.toLowerCase()))
      || (typeof code === 'string' && GEMINI_TIMEOUT_CODES.has(code.toLowerCase()));
  });
}

export function createSafeGeminiFailureTelemetry(
  error: unknown,
  model: GeminiModelLabel,
  timeoutMs: number,
  generationTimeoutMs: number,
  maxAttemptsPerModel: number
): GeminiFailureTelemetry {
  const records = getGeminiErrorRecords(error);
  const httpStatus = getSafeGeminiHttpStatus(records);
  const errorCode = getSafeGeminiErrorCode(records);
  const safeAttempts = Number.isSafeInteger(maxAttemptsPerModel) && maxAttemptsPerModel > 0
    ? maxAttemptsPerModel
    : 0;
  return {
    apiKeyPresent: true,
    model,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(errorCode === undefined ? {} : { errorCode }),
    timedOut: isGeminiTimeout(records, errorCode, httpStatus),
    timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0,
    generationTimeoutMs: Number.isSafeInteger(generationTimeoutMs) && generationTimeoutMs >= 0 ? generationTimeoutMs : 0,
    maxAttemptsPerModel: safeAttempts,
    retryCount: Math.max(0, safeAttempts - 1)
  };
}

export function createGeminiEmptyResponseTelemetry(
  model: GeminiModelLabel,
  timeoutMs: number,
  generationTimeoutMs: number,
  maxAttemptsPerModel: number
): GeminiFailureTelemetry {
  return {
    apiKeyPresent: true,
    model,
    errorCode: 'empty_response',
    timedOut: false,
    timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 ? timeoutMs : 0,
    generationTimeoutMs: Number.isSafeInteger(generationTimeoutMs) && generationTimeoutMs >= 0 ? generationTimeoutMs : 0,
    maxAttemptsPerModel: Number.isSafeInteger(maxAttemptsPerModel) && maxAttemptsPerModel > 0 ? maxAttemptsPerModel : 0,
    retryCount: Number.isSafeInteger(maxAttemptsPerModel) && maxAttemptsPerModel > 1 ? maxAttemptsPerModel - 1 : 0
  };
}

export function createMissingGeminiKeyTelemetry(generationTimeoutMs: number): GeminiFailureTelemetry {
  return {
    apiKeyPresent: false,
    model: 'not_attempted',
    timedOut: false,
    timeoutMs: 0,
    generationTimeoutMs: Number.isSafeInteger(generationTimeoutMs) && generationTimeoutMs >= 0 ? generationTimeoutMs : 0,
    maxAttemptsPerModel: 0,
    retryCount: 0
  };
}
