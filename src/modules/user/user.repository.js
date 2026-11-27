const pool = require('../../config/database');

const USER_BASE_SELECT_SQL = `
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
        u.updated_at
    FROM users u
    LEFT JOIN departments d ON d.department_id = u.department_id
    LEFT JOIN plants p ON p.plant_id = u.plant_id
    LEFT JOIN shifts s ON s.shift_id = u.default_shift_id
`;

async function attachRolesToUsers(userRows) {
    if (!Array.isArray(userRows) || userRows.length === 0) return [];
    const userIds = userRows.map((u) => u.users_id);
    const placeholders = userIds.map(() => '?').join(', ');

    const rolesRes = await pool.query(
        `SELECT
            ur.users_id,
            r.role_id,
            r.role_code,
            r.role_name
         FROM user_roles ur
         INNER JOIN roles r ON r.role_id = ur.role_id AND r.is_active = TRUE
         WHERE ur.users_id IN (${placeholders})
         ORDER BY r.role_id`,
        userIds
    );

    const roleMap = new Map();
    for (const row of rolesRes.rows) {
        if (!roleMap.has(row.users_id)) roleMap.set(row.users_id, []);
        roleMap.get(row.users_id).push({
            role_id: row.role_id,
            role_code: row.role_code,
            role_name: row.role_name,
        });
    }

    return userRows.map((u) => ({
        ...u,
        roles: roleMap.get(u.users_id) || [],
    }));
}

async function getMasterMetadata() {
    const [departmentsRes, plantsRes, shiftsRes, rolesRes] = await Promise.all([
        pool.query(`SELECT department_id, department_code, department_name, description FROM departments WHERE is_active = TRUE ORDER BY department_id`),
        pool.query(`SELECT plant_id, plant_code, plant_name, plant_address FROM plants WHERE is_active = TRUE ORDER BY plant_id`),
        pool.query(`SELECT shift_id, shift_code, shift_name, start_time, end_time, description FROM shifts WHERE is_active = TRUE ORDER BY shift_id`),
        pool.query(`SELECT role_id, role_code, role_name, role_description FROM roles WHERE is_active = TRUE ORDER BY role_id`),
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
            CAST(COUNT(u.users_id) AS SIGNED) AS user_count
        FROM roles r
        LEFT JOIN user_roles ur ON ur.role_id = r.role_id
        LEFT JOIN users u ON u.users_id = ur.users_id AND u.is_delete = FALSE
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
        const term = `%${filters.search.trim()}%`;
        conditions.push(`(
            u.first_name LIKE ?
            OR u.last_name LIKE ?
            OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
            OR u.email LIKE ?
            OR u.username LIKE ?
            OR COALESCE(u.employee_id, '') LIKE ?
        )`);
        params.push(term, term, term, term, term, term);
    }

    if (filters.departmentId) {
        conditions.push(`u.department_id = ?`);
        params.push(Number(filters.departmentId));
    }

    if (filters.plantId) {
        conditions.push(`u.plant_id = ?`);
        params.push(Number(filters.plantId));
    }

    if (filters.status === 'Active') {
        conditions.push(`u.is_active = TRUE`);
    } else if (filters.status === 'Inactive') {
        conditions.push(`u.is_active = FALSE`);
    }

    if (filters.roleId) {
        conditions.push(`EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.users_id = u.users_id AND ur2.role_id = ?)`);
        params.push(Number(filters.roleId));
    }

    const sql = `
        ${USER_BASE_SELECT_SQL}
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.users_id DESC
    `;

    const result = await pool.query(sql, params);
    return await attachRolesToUsers(result.rows);
}

async function findUserById(userId) {
    const sql = `
        ${USER_BASE_SELECT_SQL}
        WHERE u.users_id = ? AND u.is_delete = FALSE
        LIMIT 1
    `;
    const result = await pool.query(sql, [Number(userId)]);
    if (result.rows.length === 0) return null;
    const withRoles = await attachRolesToUsers(result.rows);
    return withRoles[0] || null;
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
            CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS is_locked,
            u.login_attempt_count,
            d.department_name,
            p.plant_name,
            s.shift_name
        FROM users u
        LEFT JOIN departments d ON d.department_id = u.department_id
        LEFT JOIN plants p ON p.plant_id = u.plant_id
        LEFT JOIN shifts s ON s.shift_id = u.default_shift_id
        WHERE (LOWER(u.email) = ? OR LOWER(u.username) = ?)
          AND u.is_delete = FALSE
        LIMIT 1
    `;
    const result = await pool.query(sql, [normalized, normalized]);
    if (result.rows.length === 0) return null;
    const withRoles = await attachRolesToUsers(result.rows);
    return withRoles[0] || null;
}

async function usernameExists(username, excludeUserId = null) {
    const params = [username.toLowerCase()];
    let sql = `SELECT 1 FROM users WHERE LOWER(username) = ?`;
    if (excludeUserId) {
        params.push(Number(excludeUserId));
        sql += ` AND users_id <> ?`;
    }
    const res = await pool.query(sql, params);
    return res.rows.length > 0;
}

async function createUser(data, roleIds = []) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const insertRes = await client.query(
            `INSERT INTO users (
                employee_id, first_name, last_name, username, email, mobile,
                gender, designation, department_id, plant_id, default_shift_id,
                password, is_active, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    `INSERT IGNORE INTO user_roles (users_id, role_id, assigned_by) VALUES (?, ?, ?)`,
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
            'employee_id = ?',
            'first_name = ?',
            'last_name = ?',
            'username = ?',
            'email = ?',
            'mobile = ?',
            'gender = ?',
            'designation = ?',
            'department_id = ?',
            'plant_id = ?',
            'default_shift_id = ?',
            'is_active = ?',
            'updated_by = ?',
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
            sets.push(`password = ?`);
        }

        params.push(Number(userId));
        const updateSql = `
            UPDATE users
            SET ${sets.join(', ')}
            WHERE users_id = ? AND is_delete = FALSE
        `;

        const updRes = await client.query(updateSql, params);
        if (updRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        if (Array.isArray(roleIds)) {
            await client.query(`DELETE FROM user_roles WHERE users_id = ?`, [Number(userId)]);
            for (const roleId of roleIds) {
                await client.query(
                    `INSERT IGNORE INTO user_roles (users_id, role_id, assigned_by) VALUES (?, ?, ?)`,
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
        `UPDATE users
         SET is_active = ?,
             inactive_comments = ?,
             inactive_by = ?,
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE users_id = ? AND is_delete = FALSE`,
        [Boolean(isActive), isActive ? null : comments, actorId, actorId, Number(userId)]
    );
    if (res.rowCount === 0) return null;
    return await findUserById(userId);
}

async function softDeleteUser(userId, actorId = null) {
    const res = await pool.query(
        `UPDATE users
         SET is_delete = TRUE,
             is_active = FALSE,
             inactive_by = ?,
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE users_id = ? AND is_delete = FALSE`,
        [actorId, actorId, Number(userId)]
    );
    return res.rowCount > 0;
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
