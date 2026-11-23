const otpService = require('./otp.service');

const ADMIN_EMAIL = 'admin@gmail.com';
const ADMIN_PASSWORD = 'Admin@123';

/**
 * Step 1: Validate Email + Password and send OTP
 */
async function login(req, res, next) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (normalizedEmail !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Credentials are valid -> Generate and send OTP to email
        const otpData = await otpService.generateOtp(normalizedEmail);

        return res.status(200).json({
            success: true,
            requiresOtp: true,
            message: `Verification OTP has been sent to ${normalizedEmail}`,
            data: {
                email: normalizedEmail,
                expiresInSeconds: 300,
                sentViaEmail: otpData.sentViaEmail,
                devOtp: otpData.otp // Helpful for testing if SMTP not configured
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Step 2: Verify OTP and issue session token
 */
async function verifyOtp(req, res, next) {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
            return res.status(400).json({
                success: false,
                message: 'Unrecognized email address'
            });
        }

        const verification = otpService.verifyOtp(normalizedEmail, otp);

        if (!verification.valid) {
            return res.status(400).json({
                success: false,
                message: verification.message || 'Invalid or expired OTP code'
            });
        }

        const user = {
            id: 'admin-001',
            name: 'Administrator',
            email: ADMIN_EMAIL,
            role: 'Super Admin',
            permissions: ['*']
        };

        const token = 'erp-token-' + Buffer.from(`${ADMIN_EMAIL}:${Date.now()}`).toString('base64');

        return res.status(200).json({
            success: true,
            message: 'OTP verified successfully. Login complete.',
            data: {
                token,
                user
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Resend a new OTP to email
 */
async function resendOtp(req, res, next) {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: 'Email is required to resend OTP'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email address'
            });
        }

        const otpData = await otpService.generateOtp(normalizedEmail);

        return res.status(200).json({
            success: true,
            message: `A new verification code has been sent to ${normalizedEmail}`,
            data: {
                email: normalizedEmail,
                expiresInSeconds: 300,
                sentViaEmail: otpData.sentViaEmail,
                devOtp: otpData.otp
            }
        });
    } catch (error) {
        next(error);
    }
}

async function getMe(req, res, next) {
    try {
        return res.status(200).json({
            success: true,
            data: {
                user: {
                    id: 'admin-001',
                    name: 'Administrator',
                    email: ADMIN_EMAIL,
                    role: 'Super Admin'
                }
            }
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    login,
    verifyOtp,
    resendOtp,
    getMe
};
