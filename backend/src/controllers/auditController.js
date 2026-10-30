import { AuditLog } from '../models/AuditLog.js';
import { Document } from '../models/Document.js';
import { verifyChain } from '../services/auditService.js';

export const getUserAuditLogs = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.auth?.userId;
    // Find all documents where the current user is the sender
    const userDocs = await Document.find({ sender: userId }).select('_id originalName');
    const docIds = userDocs.map(doc => doc._id);
    const docIdStrings = userDocs.map(doc => doc._id.toString());

    // Fetch audit logs related to these documents
    const logs = await AuditLog.find({
      'resource.kind': 'Document',
      $or: [
        { 'resource.id': { $in: docIds } },
        { 'resource.id': { $in: docIdStrings } }
      ]
    }).sort({ createdAt: -1 }).limit(100);

    // Map document names to the logs for frontend readability
    const enrichedLogs = logs.map(log => {
      const doc = userDocs.find(d => d._id.toString() === (log.resource?.id || '').toString());
      return {
        ...log.toObject(),
        documentName: doc ? doc.originalName : 'Unknown Document'
      };
    });

    res.status(200).json({ logs: enrichedLogs });
  } catch (error) {
    next(error);
  }
};

export async function verifyAuditChain(req, res) {
  const result = await verifyChain();
  const statusCode = result.valid ? 200 : 409;
  return res.status(statusCode).json(result);
}
