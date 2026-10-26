import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * 404 Not Found route handler.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

/**
 * Centralized error handler middleware.
 * Maps ZodError, AppError, body-parser syntax/limit errors, and unexpected exceptions.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }));
    return res.status(400).json({ error: 'Validation failed', details });
  }

  if (err instanceof AppError) {
    const payload = { error: err.message };
    if (err.code) payload.code = err.code;
    if (err.details) payload.details = err.details;
    return res.status(err.statusCode).json(payload);
  }

  if (
    err.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && err.status === 400 && 'body' in err)
  ) {
    return res.status(400).json({ error: 'Malformed JSON' });
  }

  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  console.error('[Unhandled Error]:', err);
  return res.status(500).json({ error: 'Internal server error' });
}
