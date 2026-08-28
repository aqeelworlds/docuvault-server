import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
// Ensure environment variables are loaded
dotenv.config();
function getEmailConfig() {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER || process.env.EMAIL_USER || '';
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS || '';
    const noReplyFrom = process.env.NO_REPLY_FROM || process.env.EMAIL_FROM || `"DocuVault Security" <${user || 'docuvault.app.help@gmail.com'}>`;
    const supportFrom = process.env.SUPPORT_FROM || `"DocuVault Support" <${process.env.SUPPORT_EMAIL || user || 'docuvault.app.help@gmail.com'}>`;
    const adminInbox = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || user || 'docuvault.app.help@gmail.com';
    return { host, port, secure, user, pass, noReplyFrom, supportFrom, adminInbox };
}
function createTransporter() {
    const config = getEmailConfig();
    if (!config.user || !config.pass) {
        return null;
    }
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });
}
/**
 * Send 6-digit OTP code for password recovery from no-reply@...
 */
export async function sendPasswordResetOtp(toEmail, otpCode) {
    const config = getEmailConfig();
    const transporter = createTransporter();
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b132b; color: #e2e8f0; margin: 0; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 20px; border: 1px solid #334155; padding: 32px; text-align: center; }
        .logo-badge { width: 56px; height: 56px; margin: 0 auto 16px; background: linear-gradient(135deg, #4f46e5, #06b6d4); border-radius: 16px; display: flex; align-items: center; justify-content: center; font-size: 28px; line-height: 56px; }
        h1 { color: #f8fafc; font-size: 22px; font-weight: 700; margin: 0 0 8px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 20px; }
        .code-box { background: #0f172a; border: 2px dashed #4f46e5; border-radius: 14px; padding: 18px; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; font-family: monospace; margin: 24px 0; }
        .warning { font-size: 12px; color: #f59e0b; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 10px; padding: 10px 14px; margin-top: 20px; }
        .footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #334155; font-size: 11px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo-badge">🛡️</div>
        <h1>DocuVault Password Recovery</h1>
        <p>You requested a 6-digit verification code to reset your Document Vault password. Enter this code on the recovery screen:</p>
        
        <div class="code-box">${otpCode}</div>
        
        <div class="warning">
          ⏰ <strong>Valid for 15 minutes only.</strong> Never share this verification code with anyone.
        </div>

        <div class="footer">
          This is an automated security message from DocuVault. Please do not reply directly to this email.<br>
          DocuVault • Family Document & Expiry Manager
        </div>
      </div>
    </body>
    </html>
  `;
    const textContent = `DocuVault Password Reset\n\nYour 6-digit recovery code is: ${otpCode}\n\nThis code expires in 15 minutes. If you did not request this, please ignore this email.`;
    if (!transporter) {
        console.log(`\n======================================================`);
        console.log(`📧 [EMAIL SERVICE - SMTP NOT CONFIGURED]`);
        console.log(`From: ${config.noReplyFrom}`);
        console.log(`To: ${toEmail}`);
        console.log(`Subject: 🔐 Your DocuVault Password Reset Code`);
        console.log(`Code: [ ${otpCode} ]`);
        console.log(`(To send real emails, configure Gmail/Hostinger SMTP in server/.env)`);
        console.log(`======================================================\n`);
        return true;
    }
    try {
        const info = await transporter.sendMail({
            from: config.noReplyFrom,
            to: toEmail,
            subject: `Your DocuVault Verification Code: ${otpCode}`,
            text: textContent,
            html: htmlContent,
            priority: 'high',
            headers: {
                'X-Priority': '1 (Highest)',
                'X-MSMail-Priority': 'High',
                'Importance': 'High'
            }
        });
        console.log(`✅ Password reset email sent to ${toEmail} from ${config.noReplyFrom} (MessageId: ${info.messageId})`);
        return true;
    }
    catch (err) {
        console.error(`❌ Failed to send password reset email to ${toEmail}:`, err.message);
        return false;
    }
}
/**
 * Send support inquiry email from contact form to admin & confirmation to user.
 */
export async function sendSupportInquiry(name, userEmail, userMessage) {
    const config = getEmailConfig();
    const transporter = createTransporter();
    // Admin Notification Email
    const adminHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
        .card { max-width: 550px; margin: 0 auto; background: #1e293b; border-radius: 14px; padding: 24px; border: 1px solid #334155; }
        h2 { color: #38bdf8; margin-top: 0; }
        .field { margin-bottom: 12px; }
        .label { font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: bold; }
        .val { font-size: 14px; color: #f8fafc; margin-top: 3px; }
        .msg-box { background: #0f172a; padding: 14px; border-radius: 8px; border-left: 3px solid #6366f1; white-space: pre-wrap; font-size: 13px; color: #cbd5e1; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>📩 New Support Inquiry Received</h2>
        <div class="field">
          <div class="label">Customer Name</div>
          <div class="val">${name}</div>
        </div>
        <div class="field">
          <div class="label">Customer Email (Click Reply to respond)</div>
          <div class="val"><a href="mailto:${userEmail}" style="color:#38bdf8;">${userEmail}</a></div>
        </div>
        <div class="field">
          <div class="label">Timestamp</div>
          <div class="val">${new Date().toLocaleString()}</div>
        </div>
        <div class="field">
          <div class="label">Message</div>
          <div class="msg-box">${userMessage}</div>
        </div>
      </div>
    </body>
    </html>
  `;
    // Customer Auto-Acknowledgment Email
    const userAckHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: sans-serif; background: #0b132b; color: #e2e8f0; padding: 20px; }
        .card { max-width: 500px; margin: 0 auto; background: #1e293b; border-radius: 14px; padding: 24px; border: 1px solid #334155; text-align: center; }
        h2 { color: #38bdf8; margin-top: 0; }
        p { color: #94a3b8; font-size: 13px; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>🛡️ DocuVault Support</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Thank you for reaching out to DocuVault Support. We have received your inquiry regarding:</p>
        <blockquote style="background:#0f172a; padding:12px; border-radius:8px; font-style:italic; color:#cbd5e1; font-size:12px;">"${userMessage}"</blockquote>
        <p>Our dedicated support team is reviewing your message and will reply to you at this email address within 24 hours.</p>
        <p style="font-size:11px; color:#64748b; margin-top:20px;">DocuVault Support Team • <a href="mailto:${config.adminInbox}" style="color:#38bdf8;">${config.adminInbox}</a></p>
      </div>
    </body>
    </html>
  `;
    if (!transporter) {
        console.log(`\n======================================================`);
        console.log(`📩 [SUPPORT CONTACT FORM SUBMITTED]`);
        console.log(`From Customer: ${name} <${userEmail}>`);
        console.log(`Forwarding To Admin Inbox: ${config.adminInbox}`);
        console.log(`Sender Header: ${config.supportFrom}`);
        console.log(`Message: ${userMessage}`);
        console.log(`======================================================\n`);
        return true;
    }
    try {
        // 1. Forward inquiry to Admin Support Inbox with Reply-To set to Customer
        await transporter.sendMail({
            from: config.supportFrom,
            to: config.adminInbox,
            replyTo: `"${name}" <${userEmail}>`,
            subject: `[DocuVault Support Inquiry] from ${name}`,
            html: adminHtml,
            text: `Support request from ${name} (${userEmail}):\n\n${userMessage}`,
            priority: 'high'
        });
        // 2. Send automated acknowledgment receipt to user
        await transporter.sendMail({
            from: config.supportFrom,
            to: userEmail,
            replyTo: config.adminInbox,
            subject: `🛡️ We received your request: DocuVault Support`,
            html: userAckHtml,
            text: `Hi ${name},\n\nWe received your support request. Our team will get back to you within 24 hours.\n\nDocuVault Support Team`
        }).catch(err => console.warn('User auto-ack notice:', err.message));
        console.log(`✅ Support inquiry from ${userEmail} forwarded to ${config.adminInbox}`);
        return true;
    }
    catch (err) {
        console.error(`❌ Failed to send support email:`, err.message);
        return false;
    }
}
