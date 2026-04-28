module.exports = {
  REPORT_STATUS: {
    OPEN: 'open',
    ASSIGNED: 'assigned',
    IN_PROGRESS: 'in_progress',
    FIXED: 'fixed',           // Added
    RESOLVED: 'resolved',
    CLOSED: 'closed',
    REOPENED: 'reopened',     // Added
    CANCELLED: 'cancelled'
  },
  
  PRIORITY_LEVELS: {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
  },
  
  ISSUE_TYPES: {
    BREAKDOWN: 'breakdown',
    ROUTINE: 'routine',
    INSPECTION: 'inspection',
    SAFETY: 'safety',
    ELECTRICAL: 'electrical',
    HARDWARE: 'hardware',
    SOFTWARE: 'software',
    OTHER: 'other'
  },
  
  SEVERITY_LEVELS: {
    MINOR: 'minor',
    MAJOR: 'major',
    CRITICAL: 'critical'
  },
  
  USER_ROLES: {
    EMPLOYEE: 'employee',
    SUPERVISOR: 'supervisor',
    ADMIN: 'admin',
    TECHNICIAN: 'technician'
  },
  
  NOTIFICATION_TYPES: {
    NEW_REPORT: 'new_report',
    ASSIGNED: 'assigned',
    ASSIGNMENT_UPDATE: 'assignment_update',
    STATUS_UPDATE: 'status_update',
    READY_FOR_VERIFICATION: 'ready_for_verification',
    CLOSED: 'closed',
    REPORT_CLOSED: 'report_closed',
    REOPENED: 'reopened',
    REPORT_REOPENED: 'report_reopened',
    SATISFACTION_SURVEY: 'satisfaction_survey',
    NEW_COMMENT: 'new_comment',
    ESCALATED: 'escalated',
    PENDING_ASSIGNMENT_REMINDER: 'pending_assignment_reminder',
    PENDING_VERIFICATION_REMINDER: 'pending_verification_reminder',
    OVERDUE_REPORT: 'overdue_report'
  },
  
  ERROR_MESSAGES: {
    NOT_FOUND: 'Resource not found',
    UNAUTHORIZED: 'Not authorized to access this resource',
    FORBIDDEN: 'Not authorized to perform this action',
    VALIDATION_ERROR: 'Validation error',
    SERVER_ERROR: 'Internal server error'
  }
};