const crypto = require('crypto');

exports.parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  const skip = (page - 1) * limit;
  
  return { page, limit, skip };
};

exports.buildDateFilter = (startDate, endDate) => {
  const filter = {};
  
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  
  return filter;
};

exports.formatReportForExport = (report) => ({
  'Report ID': report.reportId,
  'Title': report.title,
  'Description': report.description?.replace(/,/g, ';'),
  'Status': report.status,
  'Priority': report.priority,
  'Issue Type': report.issueType,
  'Severity': report.severity,
  'Reported By': report.reportedBy?.name || 'N/A',
  'Reported Email': report.reportedBy?.email || 'N/A',
  'Assigned To': report.assignedTo?.name || 'N/A',
  'Equipment': report.equipment?.name || 'N/A',
  'Created At': new Date(report.createdAt).toLocaleString(),
  'Resolved At': report.resolvedAt ? new Date(report.resolvedAt).toLocaleString() : 'N/A',
  'Closed At': report.closedAt ? new Date(report.closedAt).toLocaleString() : 'N/A',
  'Estimated Hours': report.estimatedHours || 0,
  'Actual Hours': report.actualHours || 0,
  'Estimated Cost': report.costEstimate || 0,
  'Actual Cost': report.actualCost || 0,
  'Root Cause': report.resolutionDetails?.rootCause || 'N/A',
  'Preventive Measures': report.resolutionDetails?.preventiveMeasures || 'N/A'
});