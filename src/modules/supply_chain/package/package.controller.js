// src/modules/supply_chain/package/package.controller.js

const service = require('./package.service');
const { validateCreatePackage } = require('./package.validation');

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
      message: 'Value rejected by a database check (for example packed quantity is more than order quantity)',
    });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
};

const createPackage = async (req, res) => {
  try {
    const { errors, data } = validateCreatePackage(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    const userId = req.user?.id ?? req.user?.user_id ?? null;
    const result = await service.createPackage(data, userId);

    return res.status(201).json({
      success: true,
      message: 'Package created successfully',
      data: result,
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create package');
  }
};

const getPackages = async (req, res) => {
  try {
    const data = await service.getPackages();
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch packages');
  }
};

const getPackageById = async (req, res) => {
  try {
    const packageId = Number(req.params.id);

    if (!Number.isInteger(packageId) || packageId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid package id' });
    }

    const data = await service.getPackageById(packageId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch package');
  }
};

// ---------- dropdown lookups ----------
const getCustomers = async (req, res) => {
  try {
    const data = await service.getCustomers();
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch customers');
  }
};

// GET ...?customerId=3
const getSalesOrders = async (req, res) => {
  try {
    const customerId = Number(req.query.customerId);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'customerId is required' });
    }

    const data = await service.getSalesOrdersByCustomer(customerId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch sales orders');
  }
};

// GET ...?customerId=3&salesOrderIds=1,2
const getPackableItems = async (req, res) => {
  try {
    const customerId = Number(req.query.customerId);
    const salesOrderIds = String(req.query.salesOrderIds || '')
      .split(',')
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ success: false, message: 'customerId is required' });
    }
    if (salesOrderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'salesOrderIds is required' });
    }

    const data = await service.getPackableItems(customerId, salesOrderIds);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch sales order items');
  }
};

module.exports = {
  createPackage,
  getPackages,
  getPackageById,
  getCustomers,
  getSalesOrders,
  getPackableItems,
};