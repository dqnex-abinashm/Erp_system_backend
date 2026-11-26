const pool = require('../../config/database');

const USER_SELECT_SQL = `
    SELECT
        u.users_id,
        u.employee_id,
        u.first_name,
        u.last_name,
        u.username,
        u.email,
        u.mobile,
        u.gender,
        u.profile_photo,
        u.designation,
        u.department_id,
        d.department_name,
        d.department_code,
        u.plant_id,
        p.plant_name,
        p.plant_code,
        u.default_shift_id,
        s.shift_name,
        s.shift_code,
        u.last_login,
        u.login_attempt_count,
        u.is_active,
        u.inactive_comments,
        u.is_delete,
        u.created_at,
        u.updated_at,
        COALESCE(
            json_agg(
                json_build_object(
                    'role_id', r.role_id,
                    'role_code', r.role_code,
                    'role_name', r.role_name
                ) ORDER BY r.role_id
            ) FILTER (WHERE r.role_id IS NOT NULL),
            '[]'::json
        ) AS roles
    FROM public.users u
    LEFT JOIN public.departments d ON d.department_id = u.department_id
    LEFT JOIN public.plants p ON p.plant_id = u.plant_id
    LEFT JOIN public.shifts s ON s.shift_id = u.default_shift_id
    LEFT JOIN public.user_roles ur ON ur.users_id = u.users_id
    LEFT JOIN public.roles r ON r.role_id = ur.role_id AND r.is_active = TRUE
`;

const USER_GROUP_BY_SQL = `
    GROUP BY
        u.users_id,
        d.department_name, d.department_code,
        p.plant_name, p.plant_code,
        s.shift_name, s.shift_code
`;

async function getMasterMetadata() {
    const [departmentsRes, plantsRes, shiftsRes, rolesRes] = await Promise.all([
        pool.query(`SELECT department_id, department_code, department_name, description FROM public.departments WHERE is_active = TRUE ORDER BY department_id`),
        pool.query(`SELECT plant_id, plant_code, plant_name, plant_address FROM public.plants WHERE is_active = TRUE ORDER BY plant_id`),
        pool.query(`SELECT shift_id, shift_code, shift_name, start_time, end_time, description FROM public.shifts WHERE is_active = TRUE ORDER BY shift_id`),
        pool.query(`SELECT role_id, role_code, role_name, role_description FROM public.roles WHERE is_active = TRUE ORDER BY role_id`),
    ]);

    return {
        departments: departmentsRes.rows,
        plants: plantsRes.rows,
        shifts: shiftsRes.rows,
        roles: rolesRes.rows,
    };
}

async function getRolesWithUserCount() {
    const result = await pool.query(`
        SELECT
            r.role_id,
            r.role_code,
            r.role_name,
            r.role_description,
            r.is_active,
            COUNT(u.users_id)::int AS user_count
        FROM public.roles r
        LEFT JOIN public.user_roles ur ON ur.role_id = r.role_id
        LEFT JOIN public.users u ON u.users_id = ur.users_id AND u.is_delete = FALSE
        WHERE r.is_active = TRUE
        GROUP BY r.role_id
        ORDER BY r.role_id
    `);
    return result.rows;
}

async function findAllUsers(filters = {}) {
    const conditions = ['u.is_delete = FALSE'];
    const params = [];

    if (filters.search) {
        params.push(`%${filters.search.trim()}%`);
        const idx = params.length;
        conditions.push(`(
            u.first_name ILIKE $${idx}
            OR u.last_name ILIKE $${idx}
            OR (u.first_name || ' ' || u.last_name) ILIKE $${idx}
            OR u.email ILIKE $${idx}
            OR u.username ILIKE $${idx}
            OR COALESCE(u.employee_id, '') ILIKE $${idx}
        )`);
    }

    if (filters.departmentId) {
        params.push(Number(filters.departmentId));
        conditions.push(`u.department_id = $${params.length}`);
    }

    if (filters.plantId) {
        params.push(Number(filters.plantId));
        conditions.push(`u.plant_id = $${params.length}`);
    }

    if (filters.status === 'Active') {
        conditions.push(`u.is_active = TRUE`);
    } else if (filters.status === 'Inactive') {
        conditions.push(`u.is_active = FALSE`);
    }

    const havingClause = filters.roleId
        ? `HAVING bool_or(ur.role_id = $${params.push(Number(filters.roleId))})`
        : '';

    const sql = `
        ${USER_SELECT_SQL}
        WHERE ${conditions.join(' AND ')}
        ${USER_GROUP_BY_SQL}
        ${havingClause}
        ORDER BY u.users_id DESC
    `;

    const result = await pool.query(sql, params);
    return result.rows;
}

async function findUserById(userId) {
    const sql = `
        ${USER_SELECT_SQL}
        WHERE u.users_id = $1 AND u.is_delete = FALSE
        ${USER_GROUP_BY_SQL}
    `;
    const result = await pool.query(sql, [Number(userId)]);
    return result.rows[0] || null;
}

async function findUserForAuth(identifier) {
    const normalized = String(identifier || '').trim().toLowerCase();
    const sql = `
        SELECT
            u.users_id,
            u.employee_id,
            u.first_name,
            u.last_name,
            u.username,
            u.email,
            u.mobile,
            u.password,
            u.is_active,
            u.is_delete,
            u.locked_until,
            u.login_attempt_count,
            d.department_name,
            p.plant_name,
            s.shift_name,
            COALESCE(
                json_agg(
                    json_build_object(
                        'role_id', r.role_id,
                        'role_code', r.role_code,
                        'role_name', r.role_name
                    ) ORDER BY r.role_id
                ) FILTER (WHERE r.role_id IS NOT NULL),
                '[]'::json
            ) AS roles
        FROM public.users u
        LEFT JOIN public.departments d ON d.department_id = u.department_id
        LEFT JOIN public.plants p ON p.plant_id = u.plant_id
        LEFT JOIN public.shifts s ON s.shift_id = u.default_shift_id
        LEFT JOIN public.user_roles ur ON ur.users_id = u.users_id
        LEFT JOIN public.roles r ON r.role_id = ur.role_id AND r.is_active = TRUE
        WHERE (LOWER(u.email) = $1 OR LOWER(u.username) = $1)
          AND u.is_delete = FALSE
        ${USER_GROUP_BY_SQL}, u.password, u.locked_until, u.login_attempt_count
        LIMIT 1
    `;
    const result = await pool.query(sql, [normalized]);
    return result.rows[0] || null;
}

async function usernameExists(username, excludeUserId = null) {
    const params = [username.toLowerCase()];
    let sql = `SELECT 1 FROM public.users WHERE LOWER(username) = $1`;
    if (excludeUserId) {
        params.push(Number(excludeUserId));
        sql += ` AND users_id <> $2`;
    }
    const res = await pool.query(sql, params);
    return res.rows.length > 0;
}

async function createUser(data, roleIds = []) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertRes = await client.query(
            `INSERT INTO public.users (
                employee_id, first_name, last_name, username, email, mobile,
                gender, designation, department_id, plant_id, default_shift_id,
                password, is_active, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING users_id`,
            [
                data.employeeId,
                data.firstName,
                data.lastName,
                data.username,
                data.email,
                data.mobile,
                data.gender,
                data.designation,
                data.departmentId,
                data.plantId,
                data.defaultShiftId,
                data.passwordHash,
                data.isActive,
                data.createdBy || null,
            ]
        );

        const newUserId = insertRes.rows[0].users_id;

        if (Array.isArray(roleIds) && roleIds.length > 0) {
            for (const roleId of roleIds) {
                await client.query(
                    `INSERT INTO public.user_roles (users_id, role_id, assigned_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (users_id, role_id) DO NOTHING`,
                    [newUserId, Number(roleId), data.createdBy || null]
                );
            }
        }

        await client.query('COMMIT');
        return await findUserById(newUserId);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function updateUser(userId, data, roleIds = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sets = [
            'employee_id = $1',
            'first_name = $2',
            'last_name = $3',
            'username = $4',
            'email = $5',
            'mobile = $6',
            'gender = $7',
            'designation = $8',
            'department_id = $9',
            'plant_id = $10',
            'default_shift_id = $11',
            'is_active = $12',
            'updated_by = $13',
            'updated_at = CURRENT_TIMESTAMP',
        ];
        const params = [
            data.employeeId,
            data.firstName,
            data.lastName,
            data.username,
            data.email,
            data.mobile,
            data.gender,
            data.designation,
            data.departmentId,
            data.plantId,
            data.defaultShiftId,
            data.isActive,
            data.updatedBy || null,
        ];

        if (data.passwordHash) {
            params.push(data.passwordHash);
            sets.push(`password = $${params.length}`);
        }

        params.push(Number(userId));
        const updateSql = `
            UPDATE public.users
            SET ${sets.join(', ')}
            WHERE users_id = $${params.length} AND is_delete = FALSE
            RETURNING users_id
        `;

        const updRes = await client.query(updateSql, params);
        if (updRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        if (Array.isArray(roleIds)) {
            await client.query(`DELETE FROM public.user_roles WHERE users_id = $1`, [Number(userId)]);
            for (const roleId of roleIds) {
                await client.query(
                    `INSERT INTO public.user_roles (users_id, role_id, assigned_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (users_id, role_id) DO NOTHING`,
                    [Number(userId), Number(roleId), data.updatedBy || null]
                );
            }
        }

        await client.query('COMMIT');
        return await findUserById(userId);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function updateUserStatus(userId, isActive, comments = null, actorId = null) {
    const res = await pool.query(
        `UPDATE public.users
         SET is_active = $1,
             inactive_comments = $2,
             inactive_by = $3,
             updated_by = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE users_id = $4 AND is_delete = FALSE
         RETURNING users_id`,
        [Boolean(isActive), isActive ? null : comments, actorId, Number(userId)]
    );
    if (res.rows.length === 0) return null;
    return await findUserById(userId);
}

async function softDeleteUser(userId, actorId = null) {
    const res = await pool.query(
        `UPDATE public.users
         SET is_delete = TRUE,
             is_active = FALSE,
             inactive_by = $1,
             updated_by = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE users_id = $2 AND is_delete = FALSE
         RETURNING users_id`,
        [actorId, Number(userId)]
    );
    return res.rows.length > 0;
}

module.exports = {
    getMasterMetadata,
    getRolesWithUserCount,
    findAllUsers,
    findUserById,
    findUserForAuth,
    usernameExists,
    createUser,
    updateUser,
    updateUserStatus,
    softDeleteUser,
};
