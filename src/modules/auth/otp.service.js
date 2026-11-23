let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    // nodemailer optional require fallback if npm install hasn't been run yet
}

// In-memory store for active OTPs: email -> { otp, expiresAt }
const otpStore = new Map();

// Helper to create mail transporter if SMTP env vars exist
function getTransporter() {
    if (!nodemailer) {
        return null;
    }
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    return null;
}

/**
 * Generate a 6-digit OTP for the given email address
 */
async function generateOtp(email) {
    const normalizedEmail = email.trim().toLowerCase();
    
    // Generate 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    otpStore.set(normalizedEmail, { otp, expiresAt });

    console.log(`\n======================================================`);
    console.log(`[AUTH OTP SERVICE] New OTP generated for: ${normalizedEmail}`);
    console.log(`>>> OTP CODE: ${otp} <<< (Valid for 5 minutes)`);
    console.log(`======================================================\n`);

    let sentViaEmail = false;
    const transporter = getTransporter();

    if (transporter) {
        try {
            await transporter.sendMail({
                from: process.env.SMTP_FROM || `"ORRNEX ERP Security" <${process.env.SMTP_USER}>`,
                to: normalizedEmail,
                subject: `Your ORRNEX ERP Login Verification Code: ${otp}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
                        <h2 style="color: #1e293b; margin-bottom: 8px;">ORRNEX ERP Verification Code</h2>
                        <p style="color: #64748b; font-size: 14px;">You are logging in to your ORRNEX ERP Administrator account. Use the code below to complete your authentication.</p>
                        <div style="background: #f1f5f9; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0;">
                            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0f172a;">${otp}</span>
                        </div>
                        <p style="color: #94a3b8; font-size: 12px;">This code will expire in 5 minutes. If you did not request this code, please ignore this email.</p>
                    </div>
                `
            });
            sentViaEmail = true;
            console.log(`[AUTH OTP SERVICE] Email sent successfully to ${normalizedEmail}`);
        } catch (mailErr) {
            console.error(`[AUTH OTP SERVICE] Failed to send email via SMTP:`, mailErr.message);
        }
    } else if (!nodemailer) {
        console.log(`[AUTH OTP SERVICE] Note: 'nodemailer' not installed. Run 'npm install' in backend to enable real email sending.`);
    } else {
        console.log(`[AUTH OTP SERVICE] SMTP not configured. OTP displayed in console and response for development.`);
    }

    return {
        otp,
        expiresAt,
        sentViaEmail
    };
}

/**
 * Verify OTP entered by the user
 */
function verifyOtp(email, enteredOtp) {
    if (!email || !enteredOtp) return false;
    const normalizedEmail = email.trim().toLowerCase();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
        return { valid: false, message: 'No OTP requested for this email or it has already been used' };
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(normalizedEmail);
        return { valid: false, message: 'OTP has expired. Please request a new one.' };
    }

    if (record.otp !== enteredOtp.toString().trim()) {
        return { valid: false, message: 'Invalid OTP code. Please check and try again.' };
    }

    // OTP verified successfully - consume it so it cannot be reused
    otpStore.delete(normalizedEmail);
    return { valid: true };
}

module.exports = {
    generateOtp,
    verifyOtp
};
