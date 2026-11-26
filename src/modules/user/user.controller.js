const userService = require('./user.service');

function sendError(res, next, err) {
    if (err && err.statusCode) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
        });
    }
    return next(err);
}

async function getMeta(req, res, next) {
    try {
        const meta = await userService.getMetaData();
        return res.status(200).json({
            success: true,
            data: meta,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function getRoles(req, res, next) {
    try {
        const roles = await userService.getRoles();
        return res.status(200).json({
            success: true,
            data: roles,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function listUsers(req, res, next) {
    try {
        const users = await userService.listUsers({
            search: req.query.search,
            departmentId: req.query.departmentId,
            plantId: req.query.plantId,
            roleId: req.query.roleId,
            status: req.query.status,
        });
        return res.status(200).json({
            success: true,
            data: users,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function getUserById(req, res, next) {
    try {
        const user = await userService.getUserById(req.params.id);
        return res.status(200).json({
            success: true,
            data: user,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function createUser(req, res, next) {
    try {
        const user = await userService.createUser(req.body, req.user?.usersId || null);
        return res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: user,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function updateUser(req, res, next) {
    try {
        const user = await userService.updateUser(req.params.id, req.body, req.user?.usersId || null);
        return res.status(200).json({
            success: true,
            message: 'User updated successfully',
            data: user,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function updateUserStatus(req, res, next) {
    try {
        const user = await userService.updateUserStatus(req.params.id, req.body, req.user?.usersId || null);
        return res.status(200).json({
            success: true,
            message: `User marked as ${user.status}`,
            data: user,
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

async function deleteUser(req, res, next) {
    try {
        await userService.deleteUser(req.params.id, req.user?.usersId || null);
        return res.status(200).json({
            success: true,
            message: 'User deleted successfully',
        });
    } catch (err) {
        return sendError(res, next, err);
    }
}

module.exports = {
    getMeta,
    getRoles,
    listUsers,
    getUserById,
    createUser,
    updateUser,
    updateUserStatus,
    deleteUser,
};
