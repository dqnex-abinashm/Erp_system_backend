// src/modules/supply_chain/shipment/shipment.routes.js

const express = require('express');
const controller = require('./shipment.controller');

const router = express.Router();

// GET /api/v1/shipments/lookups/packages?customerId=3  (must stay ABOVE '/:id')
router.get('/lookups/packages', controller.getShippablePackages);

// POST /api/v1/shipments
router.post('/', controller.createShipment);

// GET /api/v1/shipments
router.get('/', controller.getShipments);

// GET /api/v1/shipments/:id
router.get('/:id', controller.getShipmentById);

module.exports = router;