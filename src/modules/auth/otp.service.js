const pool = require('../../config/database');

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (e) {
    // nodemailer optional require fallback if npm install hasn't been run yet
}

function getTransporter() {
    if (!nodemailer) {
        return null;
    }
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const isSecure = Number(process.env.SMTP_PORT) === 465 || process.env.SMTP_SECURE === 'true';
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 465,
            secure: isSecure,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }
    return null;
}

/**
 * Generate a 6-digit OTP, persist in otp_master (and users.last_otp), and send via email.
 */
async function generateOtp(email, options = {}) {
    const normalizedEmail = email.trim().toLowerCase();
    const { userId = null, otpType = 'Login Auth', ipAddress = null, userAgent = null } = options;

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    // Expire any previous unused Login Auth OTPs for this email
    await pool.query(
        `UPDATE public.otp_master
         SET otp_status = 'EXPIRED',
             updated_at = CURRENT_TIMESTAMP
         WHERE LOWER(email) = $1
           AND otp_type = $2
           AND otp_status = 'GENERATED'`,
        [normalizedEmail, otpType]
    );

    // Insert new OTP into otp_master
    await pool.query(
        `INSERT INTO public.otp_master (
            user_id, otp_type, otp_channel, email, otp_code,
            otp_status, attempt_count, max_attempts,
            generated_at, expiry_at, ip_address, user_agent, created_by
         ) VALUES (
            $1, $2, 'EMAIL', $3, $4,
            'GENERATED', 0, 3,
            CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE), $5, $6, $1
         )`,
        [userId, otpType, normalizedEmail, otp, ipAddress, userAgent]
    );

    if (userId) {
        await pool.query(
            `UPDATE public.users
             SET last_otp = $1,
                 otp_expiry = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE),
                 updated_at = CURRENT_TIMESTAMP
             WHERE users_id = $2`,
            [otp, userId]
        );
    }

    console.log(`\n======================================================`);
    console.log(`[AUTH OTP SERVICE] New OTP generated for: ${normalizedEmail}`);
    console.log(`>>> OTP CODE: ${otp} <<< (Valid for 5 minutes)`);
    console.log(`======================================================\n`);

    let sentViaEmail = false;
    const transporter = getTransporter();

    // If using default placeholder admin@gmail.com, direct email to configured SMTP inbox
    let targetEmail = normalizedEmail;
    if ((normalizedEmail === 'admin@gmail.com' || !normalizedEmail.includes('@')) && process.env.SMTP_USER) {
        targetEmail = process.env.SMTP_USER.toLowerCase().trim();
        console.log(`[AUTH OTP SERVICE] Default admin login detected. Routing OTP email to: ${targetEmail}`);
    }

    if (transporter) {
        try {
            const rawFrom = process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;
            const formattedFrom = rawFrom && rawFrom.includes('<') ? rawFrom : `"ORRNEX ERP Security" <${rawFrom}>`;
            await transporter.sendMail({
                from: formattedFrom,
                to: targetEmail,
                subject: `Your ORRNEX ERP Login Verification Code: ${otp}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
                        <h2 style="color: #1e293b; margin-bottom: 8px;">ORRNEX ERP Verification Code</h2>
                        <p style="color: #64748b; font-size: 14px;">You are logging in to your ORRNEX ERP account. Use the code below to complete your authentication.</p>
                        <div style="background: #f1f5f9; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0;">
                            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #0f172a;">${otp}</span>
                        </div>
                        <p style="color: #64748b; font-size: 13px;">Login account: <strong>${normalizedEmail}</strong></p>
                        <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">This code will expire in 5 minutes. If you did not request this code, please ignore this email.</p>
                    </div>
                `,
            });
            sentViaEmail = true;
            console.log(`[AUTH OTP SERVICE] Email sent successfully to ${targetEmail} (for ${normalizedEmail})`);
        } catch (mailErr) {
            console.error(`[AUTH OTP SERVICE] Failed to send email via SMTP:`, mailErr.message);
        }
    } else if (!nodemailer) {
        console.log(`[AUTH OTP SERVICE] Note: 'nodemailer' not installed. Run 'npm install' in backend to enable real email sending.`);
    } else {
        console.log(`[AUTH OTP SERVICE] SMTP not configured. OTP logged to console.`);
    }

    return {
        otp,
        expiresAt,
        sentViaEmail,
    };
}

/**
 * Verify OTP against otp_master table
 */
async function verifyOtp(email, enteredOtp, otpType = 'Login Auth') {
    if (!email || !enteredOtp) {
        return { valid: false, message: 'Email and OTP are required' };
    }
    const normalizedEmail = email.trim().toLowerCase();

    const res = await pool.query(
        `SELECT otp_id, otp_code, attempt_count, max_attempts, expiry_at
         FROM public.otp_master
         WHERE LOWER(email) = $1
           AND otp_type = $2
           AND otp_status = 'GENERATED'
         ORDER BY otp_id DESC
         LIMIT 1`,
        [normalizedEmail, otpType]
    );

    const record = res.rows[0];
    if (!record) {
        return { valid: false, message: 'No active OTP requested for this email or it has already been used' };
    }

    if (new Date() > new Date(record.expiry_at)) {
        await pool.query(
            `UPDATE public.otp_master
             SET otp_status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP
             WHERE otp_id = $1`,
            [record.otp_id]
        );
        return { valid: false, message: 'OTP has expired. Please request a new one.' };
    }

    if (record.attempt_count >= record.max_attempts) {
        await pool.query(
            `UPDATE public.otp_master
             SET otp_status = 'FAILED', updated_at = CURRENT_TIMESTAMP
             WHERE otp_id = $1`,
            [record.otp_id]
        );
        return { valid: false, message: 'Maximum OTP attempts exceeded. Please request a new OTP.' };
    }

    if (String(enteredOtp).trim() !== String(record.otp_code).trim()) {
        const nextAttempts = record.attempt_count + 1;
        const nextStatus = nextAttempts >= record.max_attempts ? 'FAILED' : 'GENERATED';
        await pool.query(
            `UPDATE public.otp_master
             SET attempt_count = $1,
                 otp_status = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE otp_id = $3`,
            [nextAttempts, nextStatus, record.otp_id]
        );
        return {
            valid: false,
            message:
                nextStatus === 'FAILED'
                    ? 'Maximum OTP attempts exceeded. Please request a new OTP.'
                    : 'Invalid OTP code. Please check and try again.',
        };
    }

    await pool.query(
        `UPDATE public.otp_master
         SET otp_status = 'VERIFIED',
             verified_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE otp_id = $1`,
        [record.otp_id]
    );

    return { valid: true };
}

module.exports = {
    generateOtp,
    verifyOtp,
};
