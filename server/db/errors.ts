export class RepositoryNotFoundError extends Error {
  readonly code = 'not_found';

  constructor(message = 'The requested record was not found') {
    super(message);
    this.name = 'RepositoryNotFoundError';
  }
}

export class RepositoryConflictError extends Error {
  readonly code = 'conflict';

  constructor(message = 'The requested change conflicts with the current record') {
    super(message);
    this.name = 'RepositoryConflictError';
  }
}
