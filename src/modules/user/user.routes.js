const express = require('express');
const router = express.Router();
const userController = require('./user.controller');

router.get('/meta', userController.getMeta);
router.get('/roles', userController.getRoles);
router.get('/', userController.listUsers);
router.get('/:id', userController.getUserById);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.patch('/:id/status', userController.updateUserStatus);
router.delete('/:id', userController.deleteUser);

module.exports = router;
