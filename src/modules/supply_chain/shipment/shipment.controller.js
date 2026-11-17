// src/modules/supply_chain/shipment/shipment.controller.js

const service = require('./shipment.service');
const { validateCreateShipment } = require('./shipment.validation');

// same error response shape everywhere
const sendError = (res, error, fallbackMessage) => {
  // errors thrown by the service with a status code (HttpError)
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  // PostgreSQL errors
  if (error.code === '23505') {
    return res.status(409).json({
      success: false,
      message: 'Duplicate value: this record already exists',
    });
  }
  if (error.code === '23503') {
    return res.status(400).json({
      success: false,
      message: 'Invalid reference: a related record does not exist',
    });
  }
  if (error.code === '23514') {
    return res.status(400).json({
      success: false,
      message: 'Value rejected by a database check',
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
};

const createShipment = async (req, res) => {
  try {
    const { errors, data } = validateCreateShipment(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    const userId = req.user?.id ?? req.user?.user_id ?? null;
    const result = await service.createShipment(data, userId);

    return res.status(201).json({
      success: true,
      message: 'Shipment created successfully',
      data: result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create shipment');
  }
};
// GET /api/v1/shipments/lookups/packages?customerId=3
const getShippablePackages = async (req, res) => {
  try {
    const customerId = Number(req.query.customerId);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'customerId is required' });
    }

    const data = await service.getShippablePackages(customerId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch packages');
  }
};

// GET /api/v1/shipments
const getShipments = async (req, res) => {
  try {
    const data = await service.getShipments();
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch shipments');
  }
};

// GET /api/v1/shipments/:id
const getShipmentById = async (req, res) => {
  try {
    const shipmentId = Number(req.params.id);

    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid shipment id' });
    }

    const data = await service.getShipmentById(shipmentId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch shipment');
  }
};

module.exports = { createShipment, getShippablePackages, getShipments, getShipmentById };