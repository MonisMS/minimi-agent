export class RunError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    retryable: boolean,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'RunError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.details = details;
  }
}

export class RunNotFoundError extends RunError {
  constructor(message = 'Run was not found', details: Record<string, unknown> = {}) {
    super('run_not_found', message, 404, false, details);
    this.name = 'RunNotFoundError';
  }
}

export class RequestKeyConflictError extends RunError {
  constructor(message = 'The request key is already used for a different payload') {
    super('request_key_conflict', message, 409, false);
    this.name = 'RequestKeyConflictError';
  }
}

export class ConversationBusyError extends RunError {
  constructor(message = 'This conversation already has an active run') {
    super('conversation_busy', message, 409, true);
    this.name = 'ConversationBusyError';
  }
}

export class ProcessCapacityError extends RunError {
  constructor(message = 'The process has reached its active-run capacity') {
    super('process_capacity', message, 503, true);
    this.name = 'ProcessCapacityError';
  }
}

export class ServiceUnavailableError extends RunError {
  constructor(message = 'Live execution is not configured') {
    super('service_unavailable', message, 503, true);
    this.name = 'ServiceUnavailableError';
  }
}

export class RunStateConflictError extends RunError {
  constructor(message = 'The run state or version does not match the requested change') {
    super('run_state_conflict', message, 409, true);
    this.name = 'RunStateConflictError';
  }
}

export class InvalidRunTransitionError extends RunError {
  constructor(from: string, to: string) {
    super(
      'invalid_run_transition',
      `Run cannot move from ${from} to ${to}`,
      409,
      false,
      { from, to },
    );
    this.name = 'InvalidRunTransitionError';
  }
}

export class AdmissionError extends RunError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, 400, false, details);
    this.name = 'AdmissionError';
  }
}
