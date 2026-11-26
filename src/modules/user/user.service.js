const userRepository = require('./user.repository');
const { hashPassword } = require('./user.password');

function createHttpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function emptyToNull(val) {
    if (val === undefined || val === null) return null;
    const trimmed = String(val).trim();
    return trimmed === '' ? null : trimmed;
}

function formatUserRow(row) {
    if (!row) return null;
    const rolesList = Array.isArray(row.roles) ? row.roles : [];
    const roleNames = rolesList.map((r) => r.role_name);
    const roleIds = rolesList.map((r) => r.role_id);

    return {
        id: row.users_id,
        usersId: row.users_id,
        employeeId: row.employee_id || '',
        firstName: row.first_name,
        lastName: row.last_name,
        name: `${row.first_name} ${row.last_name}`.trim(),
        username: row.username,
        email: row.email,
        mobile: row.mobile || '',
        phone: row.mobile || '',
        gender: row.gender || '',
        profilePhoto: row.profile_photo || null,
        designation: row.designation || '',
        departmentId: row.department_id,
        department: row.department_name || '',
        departmentCode: row.department_code || '',
        plantId: row.plant_id,
        plant: row.plant_name || '',
        plantCode: row.plant_code || '',
        shiftId: row.default_shift_id,
        shift: row.shift_name || '',
        shiftCode: row.shift_code || '',
        roles: roleNames,
        roleIds,
        role: roleNames.length > 0 ? roleNames.join(', ') : 'No Role',
        isActive: row.is_active,
        status: row.is_active ? 'Active' : 'Inactive',
        inactiveComments: row.inactive_comments || '',
        lastLogin: row.last_login,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function handlePgUniqueError(err) {
    if (err && err.code === '23505') {
        const constraint = err.constraint || '';
        if (constraint.includes('email')) throw createHttpError(409, 'Email address is already registered');
        if (constraint.includes('username')) throw createHttpError(409, 'Username is already taken');
        if (constraint.includes('employee_id')) throw createHttpError(409, 'Employee ID already exists');
        if (constraint.includes('mobile')) throw createHttpError(409, 'Mobile number is already registered');
        throw createHttpError(409, 'Duplicate user record already exists');
    }
    if (err && err.code === '23503') {
        throw createHttpError(400, 'Invalid Department, Plant, Shift, or Role reference');
    }
    if (err && err.code === '23514') {
        throw createHttpError(400, 'Validation constraint failed (e.g. invalid gender value)');
    }
    throw err;
}

async function resolveLookups(payload) {
    const meta = await userRepository.getMasterMetadata();

    let departmentId = payload.departmentId ? Number(payload.departmentId) : null;
    if (!departmentId && payload.department) {
        const match = meta.departments.find(
            (d) => d.department_name.toLowerCase() === String(payload.department).trim().toLowerCase()
        );
        if (match) departmentId = match.department_id;
    }

    let plantId = payload.plantId ? Number(payload.plantId) : null;
    if (!plantId && payload.plant) {
        const match = meta.plants.find(
            (p) => p.plant_name.toLowerCase() === String(payload.plant).trim().toLowerCase()
        );
        if (match) plantId = match.plant_id;
    }

    const rawShiftId = payload.defaultShiftId || payload.shiftId;
    let defaultShiftId = rawShiftId ? Number(rawShiftId) : null;
    if (!defaultShiftId && payload.shift) {
        const match = meta.shifts.find(
            (s) => s.shift_name.toLowerCase() === String(payload.shift).trim().toLowerCase()
        );
        if (match) defaultShiftId = match.shift_id;
    }

    let roleIds = [];
    if (Array.isArray(payload.roleIds) && payload.roleIds.length > 0) {
        roleIds = payload.roleIds.map(Number).filter(Boolean);
    } else if (Array.isArray(payload.roles) && payload.roles.length > 0) {
        roleIds = payload.roles
            .map((roleInput) => {
                if (typeof roleInput === 'number') return roleInput;
                const match = meta.roles.find(
                    (r) => r.role_name.toLowerCase() === String(roleInput).trim().toLowerCase()
                );
                return match ? match.role_id : null;
            })
            .filter(Boolean);
    }

    return { departmentId, plantId, defaultShiftId, roleIds };
}

async function generateUniqueUsername(firstName, lastName, email, requestedUsername, excludeUserId = null) {
    const baseRaw = requestedUsername
        ? String(requestedUsername).trim().toLowerCase()
        : `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '') ||
          String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');

    let candidate = baseRaw || `user${Date.now()}`;
    if (requestedUsername) {
        if (await userRepository.usernameExists(candidate, excludeUserId)) {
            throw createHttpError(409, 'Username is already taken');
        }
        return candidate;
    }

    let suffix = 1;
    while (await userRepository.usernameExists(candidate, excludeUserId)) {
        candidate = `${baseRaw}${suffix}`;
        suffix += 1;
    }
    return candidate;
}

async function getMetaData() {
    const meta = await userRepository.getMasterMetadata();
    return {
        departments: meta.departments.map((d) => ({
            id: d.department_id,
            code: d.department_code,
            name: d.department_name,
            description: d.description,
        })),
        plants: meta.plants.map((p) => ({
            id: p.plant_id,
            code: p.plant_code,
            name: p.plant_name,
            address: p.plant_address,
        })),
        shifts: meta.shifts.map((s) => ({
            id: s.shift_id,
            code: s.shift_code,
            name: s.shift_name,
            startTime: s.start_time,
            endTime: s.end_time,
            description: s.description,
        })),
        roles: meta.roles.map((r) => ({
            id: r.role_id,
            code: r.role_code,
            name: r.role_name,
            description: r.role_description,
        })),
    };
}

async function getRoles() {
    const rows = await userRepository.getRolesWithUserCount();
    return rows.map((r) => ({
        id: r.role_id,
        code: r.role_code,
        name: r.role_name,
        description: r.role_description,
        isActive: r.is_active,
        userCount: r.user_count,
    }));
}

async function listUsers(filters) {
    const rows = await userRepository.findAllUsers(filters);
    return rows.map(formatUserRow);
}

async function getUserById(userId) {
    const row = await userRepository.findUserById(userId);
    if (!row) throw createHttpError(404, 'User not found');
    return formatUserRow(row);
}

async function createUser(payload, actorId = null) {
    const firstName = emptyToNull(payload.firstName);
    const lastName = emptyToNull(payload.lastName);
    const email = emptyToNull(payload.email)?.toLowerCase();

    if (!firstName) throw createHttpError(400, 'First name is required');
    if (!lastName) throw createHttpError(400, 'Last name is required');
    if (!email) throw createHttpError(400, 'Email ID is required');

    const { departmentId, plantId, defaultShiftId, roleIds } = await resolveLookups(payload);
    if (roleIds.length === 0) {
        throw createHttpError(400, 'Please assign at least one role');
    }

    const username = await generateUniqueUsername(firstName, lastName, email, emptyToNull(payload.username));
    const rawPassword = emptyToNull(payload.password) || 'Welcome@123';
    const passwordHash = hashPassword(rawPassword);

    const isActive =
        typeof payload.isActive === 'boolean'
            ? payload.isActive
            : payload.status
              ? payload.status === 'Active'
              : true;

    try {
        const created = await userRepository.createUser(
            {
                employeeId: emptyToNull(payload.employeeId),
                firstName,
                lastName,
                username,
                email,
                mobile: emptyToNull(payload.mobile || payload.phone),
                gender: emptyToNull(payload.gender),
                designation: emptyToNull(payload.designation),
                departmentId,
                plantId,
                defaultShiftId,
                passwordHash,
                isActive,
                createdBy: actorId,
            },
            roleIds
        );
        return formatUserRow(created);
    } catch (err) {
        handlePgUniqueError(err);
    }
}

async function updateUser(userId, payload, actorId = null) {
    const existing = await userRepository.findUserById(userId);
    if (!existing) throw createHttpError(404, 'User not found');

    const firstName = emptyToNull(payload.firstName) || existing.first_name;
    const lastName = emptyToNull(payload.lastName) || existing.last_name;
    const email = (emptyToNull(payload.email) || existing.email).toLowerCase();
    const username = payload.username
        ? await generateUniqueUsername(firstName, lastName, email, payload.username, userId)
        : existing.username;

    const { departmentId, plantId, defaultShiftId, roleIds } = await resolveLookups(payload);
    const finalRoleIds =
        payload.roleIds !== undefined || payload.roles !== undefined
            ? roleIds
            : null;

    if (finalRoleIds !== null && finalRoleIds.length === 0) {
        throw createHttpError(400, 'Please assign at least one role');
    }

    const isActive =
        typeof payload.isActive === 'boolean'
            ? payload.isActive
            : payload.status !== undefined
              ? payload.status === 'Active'
              : existing.is_active;

    const passwordHash = emptyToNull(payload.password) ? hashPassword(payload.password) : null;

    try {
        const updated = await userRepository.updateUser(
            userId,
            {
                employeeId: payload.employeeId !== undefined ? emptyToNull(payload.employeeId) : existing.employee_id,
                firstName,
                lastName,
                username,
                email,
                mobile:
                    payload.mobile !== undefined || payload.phone !== undefined
                        ? emptyToNull(payload.mobile ?? payload.phone)
                        : existing.mobile,
                gender: payload.gender !== undefined ? emptyToNull(payload.gender) : existing.gender,
                designation: payload.designation !== undefined ? emptyToNull(payload.designation) : existing.designation,
                departmentId: departmentId ?? existing.department_id,
                plantId: plantId ?? existing.plant_id,
                defaultShiftId: defaultShiftId ?? existing.default_shift_id,
                isActive,
                passwordHash,
                updatedBy: actorId,
            },
            finalRoleIds
        );
        return formatUserRow(updated);
    } catch (err) {
        handlePgUniqueError(err);
    }
}

async function updateUserStatus(userId, payload, actorId = null) {
    const isActive =
        typeof payload.isActive === 'boolean'
            ? payload.isActive
            : payload.status === 'Active';
    const updated = await userRepository.updateUserStatus(
        userId,
        isActive,
        emptyToNull(payload.comments),
        actorId
    );
    if (!updated) throw createHttpError(404, 'User not found');
    return formatUserRow(updated);
}

async function deleteUser(userId, actorId = null) {
    const deleted = await userRepository.softDeleteUser(userId, actorId);
    if (!deleted) throw createHttpError(404, 'User not found');
    return true;
}

module.exports = {
    getMetaData,
    getRoles,
    listUsers,
    getUserById,
    createUser,
    updateUser,
    updateUserStatus,
    deleteUser,
    formatUserRow,
};
