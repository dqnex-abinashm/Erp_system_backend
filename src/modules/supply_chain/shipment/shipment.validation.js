// src/modules/supply_chain/shipment/shipment.validation.js

const { SHIPMENT_STATUS, CREATE_ALLOWED_STATUS } = require('./shipment.constant');

// ---------- validation helpers (errors are pushed as { msg }) ----------
const isBlank = (value) =>
  value === undefined ||
  value === null ||
  String(value).trim() === '';

const toNumber = (value, label, errors, options = {}) => {
  const { required = false, min, gt } = options;

  if (isBlank(value)) {
    if (required) errors.push({ msg: `${label} is required` });
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    errors.push({ msg: `${label} must be a valid number` });
    return null;
  }
  if (min !== undefined && number < min) {
    errors.push({ msg: `${label} must be ${min} or more` });
  }
  if (gt !== undefined && number <= gt) {
    errors.push({ msg: `${label} must be more than ${gt}` });
  }

  return number;
};

const toText = (value, label, errors, options = {}) => {
  const { required = false, max } = options;

  if (isBlank(value)) {
    if (required) errors.push({ msg: `${label} is required` });
    return null;
  }

  const text = String(value).trim();

  if (max && text.length > max) {
    errors.push({ msg: `${label} must be ${max} characters or less` });
  }

  return text;
};

// date must be YYYY-MM-DD
const toDate = (value, label, errors, required = false) => {
  if (isBlank(value)) {
    if (required) errors.push({ msg: `${label} is required` });
    return null;
  }

  const text = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    errors.push({ msg: `${label} must be a valid date (YYYY-MM-DD)` });
    return null;
  }

  return text;
};

const toBoolean = (value) => value === true || value === 'true';

const isValidUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
};

/**
 * Checks the create shipment request and returns clean values.
 * Returns: { errors: [{ msg }], data }
 */
const validateCreateShipment = (body = {}) => {
  const errors = [];

  const status = isBlank(body.status)
    ? SHIPMENT_STATUS.DRAFT
    : String(body.status).trim().toUpperCase();

  if (!CREATE_ALLOWED_STATUS.includes(status)) {
    errors.push({ msg: `Status must be one of: ${CREATE_ALLOWED_STATUS.join(', ')}` });
  }

  // carrier, tracking number and tracking URL are NOT NULL in the shipment table,
  // so they are required even for a draft
  const trackingUrl = toText(body.trackingUrl, 'Tracking URL', errors, { required: true });
  if (trackingUrl && !isValidUrl(trackingUrl)) {
    errors.push({ msg: 'Tracking URL must start with http:// or https://' });
  }

  const data = {
    status,
    customerId: toNumber(body.customerId, 'Customer', errors, { required: true, gt: 0 }),
    packageId: toNumber(body.packageId, 'Package slip', errors, { required: true, gt: 0 }),
    billingAddressId: toNumber(body.billingAddressId, 'Billing address', errors, { gt: 0 }),
    shippingAddressId: toNumber(body.shippingAddressId, 'Shipping address', errors, { gt: 0 }),
    shipDate: toDate(body.shipDate, 'Ship date', errors, true),
    carrier: toText(body.carrier, 'Carrier', errors, { required: true, max: 150 }),
    trackingNumber: toText(body.trackingNumber, 'Tracking number', errors, { required: true, max: 100 }),
    trackingUrl,
    shippingCharges: toNumber(body.shippingCharges, 'Shipping charges', errors, { min: 0 }) ?? 0,
    currencyCode: toText(body.currencyCode, 'Currency', errors, { max: 10 }) || 'INR',
    isDelivered: toBoolean(body.isDelivered),
    deliveredDate: toDate(body.deliveredDate, 'Delivered date', errors),
    sendStatusNotification: toBoolean(body.sendStatusNotification),
    remarks: toText(body.remarks, 'Note', errors),
  };

  return { errors, data };
};

module.exports = { validateCreateShipment };