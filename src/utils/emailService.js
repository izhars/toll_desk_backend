// src/utils/emailService.js
const nodemailer = require('nodemailer');

exports.sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
    to: options.email,
    subject: options.subject,
    html: options.template
  };

  await transporter.sendMail(mailOptions);
};

const sendAssignmentEmail = async ({ report, assignee, assignedBy, isReassignment, reassignmentReason, notes }) => {
  const subject = isReassignment
    ? `Report Reassigned: ${report.title}`
    : `New Report Assigned: ${report.title}`;

  const priorityConfig = {
    low:      { color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', label: 'LOW' },
    medium:   { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'MEDIUM' },
    high:     { color: '#EA580C', bg: '#FFF7ED', border: '#FDBA74', label: 'HIGH' },
    critical: { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'CRITICAL' }
  };

  const p = priorityConfig[report.priority] || priorityConfig.medium;

  // Get plaza name correctly
  const plazaName = report.plazaId?.name || 
                    (typeof report.plazaId === 'object' ? report.plazaId.name : 'Not specified');

  const notesHtml = notes ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td style="background: #EFF6FF; border-left: 3px solid #2563EB; border-radius: 0 6px 6px 0; padding: 14px 16px;">
          <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #2563EB;">Assignment Notes</p>
          <p style="margin: 0; font-size: 14px; color: #1E3A5F; line-height: 1.6;">${notes.replace(/\n/g, '<br>')}</p>
        </td>
      </tr>
    </table>` : '';

  const reassignmentReasonHtml = reassignmentReason ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
      <tr>
        <td style="background: #FFFBEB; border-left: 3px solid #D97706; border-radius: 0 6px 6px 0; padding: 14px 16px;">
          <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #D97706;">Reassignment Reason</p>
          <p style="margin: 0; font-size: 14px; color: #431407; line-height: 1.6;">${reassignmentReason.replace(/\n/g, '<br>')}</p>
        </td>
      </tr>
    </table>` : '';

  const createdDate = new Date(report.createdAt).toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });

  const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F1F5F9; font-family: Georgia, 'Times New Roman', serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background: #F1F5F9; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- HEADER -->
          <tr>
            <td style="background: #0F2744; border-radius: 12px 12px 0 0; padding: 36px 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <table cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                      <tr>
                        <td style="background: #1D3F72; border-radius: 8px; padding: 8px 14px;">
                          <span style="font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: #93C5FD; text-transform: uppercase;">&#9632; TPMS</span>
                        </td>
                        <td style="padding-left: 12px;">
                          <span style="font-family: 'Courier New', monospace; font-size: 11px; color: #64748B; letter-spacing: 0.06em;">TOLL PLAZA MAINTENANCE SYSTEM</span>
                        </td>
                      </tr>
                    </table>

                    <h1 style="margin: 0 0 8px 0; font-size: 26px; font-weight: 400; color: #F8FAFC; letter-spacing: -0.01em; line-height: 1.2;">
                      ${isReassignment ? 'Report Reassigned' : 'New Report Assigned'}
                      <span style="display: block; color: #93C5FD; font-size: 15px; font-weight: 400; font-style: italic; margin-top: 6px;">to you by ${assignedBy.name}</span>
                    </h1>
                  </td>
                  <td valign="top" align="right" style="padding-left: 20px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="border: 1px solid #1D3F72; border-radius: 8px; padding: 10px 16px; text-align: center;">
                          <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 10px; color: #64748B; letter-spacing: 0.1em; text-transform: uppercase;">Report</p>
                          <p style="margin: 4px 0 0; font-family: 'Courier New', monospace; font-size: 16px; font-weight: 700; color: #93C5FD; letter-spacing: 0.05em;">#${report.reportId}</p>
                        </td>
                      </table>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 24px;">
                <tr>
                  <td style="background: ${p.bg}; border: 1px solid ${p.border}; border-radius: 8px; padding: 10px 16px;">
                    <table cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td>
                          <span style="font-family: 'Courier New', monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: ${p.color};">&#11044; ${p.label} PRIORITY</span>
                        </td>
                        <td align="right">
                          <span style="font-size: 12px; color: #64748B;">${report.issueType || 'General Maintenance'}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background: #FFFFFF; padding: 36px 40px;">
              <p style="margin: 0 0 24px 0; font-size: 15px; color: #374151; line-height: 1.7;">
                Hello <strong style="color: #0F172A;">${assignee.name}</strong>,<br>
                ${isReassignment
                  ? `This maintenance report has been reassigned to you. Please review the details below and take the necessary action.`
                  : `You have been assigned a new maintenance report. Please review the details below and begin addressing the issue.`
                }
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                <tr><td style="border-top: 1px solid #E2E8F0;"></td></tr>
              </table>

              <!-- Report Details -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;">
                <tr>
                  <td colspan="2" style="background: #F8FAFC; border-bottom: 1px solid #E2E8F0; padding: 14px 20px;">
                    <p style="margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8;">Report Title</p>
                    <p style="margin: 4px 0 0; font-size: 17px; font-weight: 600; color: #0F172A; letter-spacing: -0.01em;">${report.title}</p>
                  </td>
                </tr>

                <tr>
                  <td width="50%" style="padding: 14px 20px; border-bottom: 1px solid #E2E8F0; border-right: 1px solid #E2E8F0; vertical-align: top;">
                    <p style="margin: 0 0 4px 0; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8;">Location</p>
                    <p style="margin: 0; font-size: 14px; color: #0F172A; font-weight: 500;">${plazaName}</p>
                  </td>
                  <td width="50%" style="padding: 14px 20px; border-bottom: 1px solid #E2E8F0; vertical-align: top;">
                    <p style="margin: 0 0 4px 0; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8;">Created On</p>
                    <p style="margin: 0; font-size: 14px; color: #0F172A; font-weight: 500;">${createdDate}</p>
                  </td>
                </tr>

                <!-- Description -->
                <tr>
                  <td colspan="2" style="padding: 14px 20px; vertical-align: top;">
                    <p style="margin: 0 0 6px 0; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8;">Description</p>
                    <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.65;">${report.description || 'No description provided.'}</p>
                  </td>
                </tr>
              </table>

              <!-- Reassignment Reason (only shown for reassignments) -->
              ${isReassignment ? reassignmentReasonHtml : ''}
              
              <!-- Additional Notes -->
              ${notesHtml}

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0 0;">
                <tr>
                  <td align="center">
                    <a href="${process.env.FRONTEND_URL}/maintenance/report/${report._id}"
                       style="display: inline-block; background: #0F2744; color: #FFFFFF; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-size: 14px; font-weight: 600; letter-spacing: 0.04em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
                      View Full Report &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background: #F8FAFC; border-top: 1px solid #E2E8F0; border-radius: 0 0 12px 12px; padding: 20px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 11px; color: #94A3B8; letter-spacing: 0.05em;">
                      This is an automated notification &mdash; please do not reply.
                    </p>
                  </td>
                  <td align="right">
                    <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 11px; color: #CBD5E1; letter-spacing: 0.05em;">TPMS &copy; ${new Date().getFullYear()}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await exports.sendEmail({
    email: assignee.email,
    subject: subject,
    template: htmlTemplate
  });
};

exports.sendAssignmentEmail = sendAssignmentEmail;