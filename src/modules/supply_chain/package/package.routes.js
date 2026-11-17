// src/modules/supply_chain/package/package.routes.js

const express = require('express');
const controller = require('./package.controller');

const router = express.Router();

// dropdown lookups (these must stay ABOVE '/:id')
// GET /api/v1/packages/lookups/customers
router.get('/lookups/customers', controller.getCustomers);
// GET /api/v1/packages/lookups/sales-orders?customerId=3
router.get('/lookups/sales-orders', controller.getSalesOrders);
// GET /api/v1/packages/lookups/packable-items?customerId=3&salesOrderIds=1,2
router.get('/lookups/packable-items', controller.getPackableItems);

// POST /api/v1/packages
router.post('/', controller.createPackage);

// GET /api/v1/packages
router.get('/', controller.getPackages);

// GET /api/v1/packages/:id
router.get('/:id', controller.getPackageById);

module.exports = router;