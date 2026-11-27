const crypto = require('crypto');
const pool = require('../../config/database');
const otpService = require('./otp.service');
const userRepository = require('../user/user.repository');
const { verifyPassword } = require('../user/user.password');

const DEFAULT_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'info@dqnex.com').trim().toLowerCase();

function getClientMeta(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ipAddress = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip || '').slice(0, 45);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    return { ipAddress, userAgent };
}

async function resolveAuthUser(identifier) {
    const normalized = String(identifier || '').trim().toLowerCase();
    let user = await userRepository.findUserForAuth(normalized);
    if (!user && normalized === 'admin@gmail.com') {
        user = await userRepository.findUserForAuth(DEFAULT_ADMIN_EMAIL);
    }
    return user;
}

function formatAuthUser(user, loginEmail) {
    const rolesList = Array.isArray(user.roles) ? user.roles.map((r) => r.role_name) : [];
    const primaryRole = rolesList[0] || 'Operator';
    return {
        id: user.users_id,
        usersId: user.users_id,
        employeeId: user.employee_id || '',
        firstName: user.first_name,
        lastName: user.last_name,
        name: `${user.first_name} ${user.last_name}`.trim(),
        username: user.username,
        email: loginEmail || user.email,
        role: primaryRole,
        roles: rolesList,
        department: user.department_name || '',
        plant: user.plant_name || '',
        shift: user.shift_name || '',
        permissions: rolesList.includes('Super Admin') ? ['*'] : rolesList,
    };
}

/**
 * Step 1: Validate Email/Username + Password against PostgreSQL users table and send OTP
 */
async function login(req, res, next) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required',
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await resolveAuthUser(normalizedEmail);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: 'Account is inactive. Please contact administrator.',
            });
        }

        if (Number(user.is_locked) === 1) {
            return res.status(423).json({
                success: false,
                message: 'Account temporarily locked due to multiple failed attempts. Try again later.',
            });
        }

        const passwordValid = verifyPassword(password, user.password);
        if (!passwordValid) {
            const attempts = (user.login_attempt_count || 0) + 1;
            const lockSql = attempts >= 5 ? ', locked_until = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE)' : '';
            await pool.query(
                `UPDATE public.users
                 SET login_attempt_count = $1 ${lockSql},
                     updated_at = CURRENT_TIMESTAMP
                 WHERE users_id = $2`,
                [attempts, user.users_id]
            );
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        // Reset failed login attempts
        if ((user.login_attempt_count || 0) > 0 || user.locked_until) {
            await pool.query(
                `UPDATE public.users
                 SET login_attempt_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE users_id = $1`,
                [user.users_id]
            );
        }

        const { ipAddress, userAgent } = getClientMeta(req);
        const otpData = await otpService.generateOtp(normalizedEmail, {
            userId: user.users_id,
            otpType: 'Login Auth',
            ipAddress,
            userAgent,
        });

        return res.status(200).json({
            success: true,
            requiresOtp: true,
            message: `Verification OTP has been sent to ${normalizedEmail}`,
            data: {
                email: normalizedEmail,
                expiresInSeconds: 300,
                sentViaEmail: otpData.sentViaEmail,
                ...(process.env.NODE_ENV !== 'production' ? { devOtp: otpData.otp } : {}),
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Step 2: Verify OTP in otp_master and record session in login_sessions
 */
async function verifyOtp(req, res, next) {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: 'Email and OTP are required',
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await resolveAuthUser(normalizedEmail);

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Unrecognized email address',
            });
        }

        const verification = await otpService.verifyOtp(normalizedEmail, otp, 'Login Auth');
        if (!verification.valid) {
            return res.status(400).json({
                success: false,
                message: verification.message || 'Invalid or expired OTP code',
            });
        }

        const token = 'erp-token-' + crypto.randomBytes(32).toString('hex');
        const refreshToken = 'erp-refresh-' + crypto.randomBytes(32).toString('hex');
        const { ipAddress, userAgent } = getClientMeta(req);

        await pool.query(
            `UPDATE public.users
             SET last_login = CURRENT_TIMESTAMP,
                 last_otp = NULL,
                 otp_expiry = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE users_id = $1`,
            [user.users_id]
        );

        await pool.query(
            `INSERT INTO public.login_sessions (
                user_id, username, access_token, refresh_token,
                login_status, login_time, last_activity, session_expiry,
                ip_address, user_agent, is_current_session, created_by
             ) VALUES (
                $1, $2, $3, $4,
                'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR),
                $5, $6, TRUE, $1
             )`,
            [user.users_id, user.username, token, refreshToken, ipAddress, userAgent]
        );

        const formattedUser = formatAuthUser(user, normalizedEmail);

        return res.status(200).json({
            success: true,
            message: 'OTP verified successfully. Login complete.',
            data: {
                token,
                user: formattedUser,
            },
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
                message: 'Email is required to resend OTP',
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await resolveAuthUser(normalizedEmail);

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email address',
            });
        }

        const { ipAddress, userAgent } = getClientMeta(req);
        const otpData = await otpService.generateOtp(normalizedEmail, {
            userId: user.users_id,
            otpType: 'Login Auth',
            ipAddress,
            userAgent,
        });

        return res.status(200).json({
            success: true,
            message: `A new verification code has been sent to ${normalizedEmail}`,
            data: {
                email: normalizedEmail,
                expiresInSeconds: 300,
                sentViaEmail: otpData.sentViaEmail,
                ...(process.env.NODE_ENV !== 'production' ? { devOtp: otpData.otp } : {}),
            },
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Logout current session in login_sessions table
 */
async function logout(req, res, next) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.body?.token;

        if (token) {
            await pool.query(
                `UPDATE public.login_sessions
                 SET login_status = 'LOGGED_OUT',
                     logout_time = CURRENT_TIMESTAMP,
                     is_current_session = FALSE,
                     logout_reason = 'User Logout',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE access_token = $1 AND login_status = 'ACTIVE'`,
                [token]
            );
        }

        return res.status(200).json({
            success: true,
            message: 'Logged out successfully',
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Get currently authenticated user via active login_sessions record
 */
async function getMe(req, res, next) {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authorization token is required',
            });
        }

        const sessionRes = await pool.query(
            `SELECT session_id, user_id, session_expiry,
                    CASE WHEN session_expiry IS NOT NULL AND session_expiry < CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS is_expired
             FROM public.login_sessions
             WHERE access_token = $1 AND login_status = 'ACTIVE'
             LIMIT 1`,
            [token]
        );

        const session = sessionRes.rows[0];
        if (!session) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or terminated session',
            });
        }

        if (Number(session.is_expired) === 1) {
            await pool.query(
                `UPDATE public.login_sessions
                 SET login_status = 'EXPIRED', is_current_session = FALSE, updated_at = CURRENT_TIMESTAMP
                 WHERE session_id = $1`,
                [session.session_id]
            );
            return res.status(401).json({
                success: false,
                message: 'Session has expired. Please login again.',
            });
        }

        await pool.query(
            `UPDATE public.login_sessions
             SET last_activity = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE session_id = $1`,
            [session.session_id]
        );

        const userRow = await userRepository.findUserById(session.user_id);
        if (!userRow || !userRow.is_active) {
            return res.status(401).json({
                success: false,
                message: 'User account not found or inactive',
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                user: formatAuthUser(userRow, userRow.email),
            },
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    login,
    verifyOtp,
    resendOtp,
    logout,
    getMe,
};
