// src/modules/supply_chain/package/package.validation.js

const { PACKAGE_STATUS, CREATE_ALLOWED_STATUS } = require('./package.constant');

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

/**
 * Checks the create package request and returns clean values.
 * Returns: { errors: [{ msg }], data }
 */
const validateCreatePackage = (body = {}) => {
  const errors = [];

  const status = isBlank(body.status)
    ? PACKAGE_STATUS.DRAFT
    : String(body.status).trim().toUpperCase();

  if (!CREATE_ALLOWED_STATUS.includes(status)) {
    errors.push({ msg: `Status must be one of: ${CREATE_ALLOWED_STATUS.join(', ')}` });
  }

  // a draft can be saved half filled, a packed package cannot
  const isPacked = status === PACKAGE_STATUS.PACKED;

  const data = {
    status,
    customerId: toNumber(body.customerId, 'Customer', errors, { required: true, gt: 0 }),
    billingAddressId: toNumber(body.billingAddressId, 'Billing address', errors, { gt: 0 }),
    shippingAddressId: toNumber(body.shippingAddressId, 'Shipping address', errors, { gt: 0 }),
    packageSlipNumber: toText(body.packageSlipNumber, 'Package slip number', errors, { required: true, max: 50 }),
    packageDate: toDate(body.packageDate, 'Package date', errors, true),
    expectedShipmentDate: toDate(body.expectedShipmentDate, 'Expected shipment date', errors),
    packageType: toText(body.packageType, 'Package type', errors, { required: isPacked, max: 50 }),
    dimensionLength: toNumber(body.dimensionLength, 'Length', errors, { min: 0 }),
    dimensionWidth: toNumber(body.dimensionWidth, 'Width', errors, { min: 0 }),
    dimensionHeight: toNumber(body.dimensionHeight, 'Height', errors, { min: 0 }),
    dimensionUnit: toText(body.dimensionUnit, 'Dimension unit', errors, { max: 20 }) || 'cm',
    totalWeight: toNumber(body.totalWeight, 'Total weight', errors, { required: isPacked, gt: 0 }),
    weightUnit: toText(body.weightUnit, 'Weight unit', errors, { max: 20 }) || 'Kg',
    totalQuantity: toNumber(body.totalQuantity, 'Total quantity', errors, { required: isPacked, gt: 0 }),
    quantityUnit: toText(body.quantityUnit, 'Quantity unit', errors, { max: 30 }),
    remarks: toText(body.remarks, 'Note', errors),
    items: [],
  };

  // ---------- items ----------
  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push({ msg: 'At least one item is required' });
  } else {
    body.items.forEach((item, index) => {
      const row = `Item ${index + 1}`;

      const totalQuantity = toNumber(item.totalQuantity, `${row} order quantity`, errors, { required: true, min: 0 });
      const packQuantity = toNumber(item.packQuantity, `${row} packed quantity`, errors, { required: true, gt: 0 });

      if (totalQuantity !== null && packQuantity !== null && packQuantity > totalQuantity) {
        errors.push({ msg: `${row} packed quantity cannot be more than order quantity` });
      }

      data.items.push({
        salesOrderItemId: toNumber(item.salesOrderItemId, `${row} sales order item`, errors, { gt: 0 }),
        itemCode: toText(item.itemCode, `${row} code`, errors, { max: 50 }),
        itemName: toText(item.itemName, `${row} name`, errors, { max: 255 }),
        itemDescription: toText(item.itemDescription, `${row} description`, errors),
        itemOrderDate: toDate(item.itemOrderDate, `${row} order date`, errors),
        totalQuantity,
        packQuantity,
        packWeight: toNumber(item.packWeight, `${row} weight`, errors, { min: 0 }),
        remarks: toText(item.remarks, `${row} remarks`, errors),
      });
    });
  }

  return { errors, data };
};

module.exports = { validateCreatePackage };