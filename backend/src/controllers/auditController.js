import { verifyChain } from '../services/auditService.js';

export async function verifyAuditChain(req, res) {
  const result = await verifyChain();
  const statusCode = result.valid ? 200 : 409;
  return res.status(statusCode).json(result);
}
