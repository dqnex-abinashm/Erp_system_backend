// src/modules/supply_chain/package/package.repository.js

const pool = require('../../../config/database');
const Q = require('./package-code');

// Functions that receive a pg client run inside the service's transaction.

const lockPackageNumber = (client) => client.query(Q.LOCK_PACKAGE_NUMBER);

const getNextPackageSeq = async (client) => {
  const { rows } = await client.query(Q.GET_NEXT_PACKAGE_SEQ);
  return rows[0].next_seq;
};

const slipNumberExists = async (client, slipNumber) => {
  const { rows } = await client.query(Q.CHECK_PACKAGE_SLIP_NUMBER, [slipNumber]);
  return rows.length > 0;
};

const createPackage = async (client, p) => {
  const { rows } = await client.query(Q.CREATE_PACKAGE, [
    p.packageNumber,
    p.packageSlipNumber,
    p.customerId,
    p.billingAddressId,
    p.shippingAddressId,
    p.packageType,
    p.packageDate,
    p.dimensionLength,
    p.dimensionWidth,
    p.dimensionHeight,
    p.dimensionUnit,
    p.totalWeight,
    p.weightUnit,
    p.totalQuantity,
    p.quantityUnit,
    p.status,
    p.expectedShipmentDate,
    p.remarks,
    p.userId,
  ]);
  return rows[0];
};

const createPackageItem = async (client, packageId, customerId, item, userId) => {
  const { rows } = await client.query(Q.CREATE_PACKAGE_ITEM, [
    packageId,
    customerId,
    item.salesOrderItemId,
    item.itemCode,
    item.itemName,
    item.itemDescription,
    item.itemOrderDate,
    item.totalQuantity,
    item.packQuantity,
    item.packWeight,
    item.remarks,
    userId,
  ]);
  return rows[0];
};

const getAllPackages = async (client) => {
  const { rows } = await client.query(Q.GET_ALL_PACKAGES);
  return rows;
};

const getPackageDetails = async (client, packageId) => {
  const { rows } = await client.query(Q.GET_PACKAGE_DETAILS, [packageId]);
  return rows[0] || null;
};

const getPackageDetailItems = async (client, packageId) => {
  const { rows } = await client.query(Q.GET_PACKAGE_DETAIL_ITEMS, [packageId]);
  return rows;
};

// ---------- dropdown lookups ----------
const getCustomers = async () => {
  const { rows } = await pool.query(Q.GET_CUSTOMERS);
  return rows;
};

const getSalesOrdersByCustomer = async (customerId) => {
  const { rows } = await pool.query(Q.GET_SALES_ORDERS_BY_CUSTOMER, [customerId]);
  return rows;
};

const getPackableItems = async (customerId, salesOrderIds) => {
  const ids = Array.isArray(salesOrderIds) ? salesOrderIds.map(Number).filter(Boolean) : [];
  if (ids.length === 0) return [];
  const sql = Q.buildGetPackableItemsQuery(ids.length);
  const { rows } = await pool.query(sql, [customerId, ...ids]);
  return rows;
};

// receives a pg client so it can run inside the create package transaction
const getItemRemaining = async (client, salesOrderItemId) => {
  const { rows } = await client.query(Q.GET_ITEM_REMAINING_QUANTITY, [salesOrderItemId]);
  return rows[0] || null;
};

module.exports = {
  lockPackageNumber,
  getNextPackageSeq,
  slipNumberExists,
  createPackage,
  createPackageItem,
  getAllPackages,
  getPackageDetails,
  getPackageDetailItems,
  getCustomers,
  getSalesOrdersByCustomer,
  getPackableItems,
  getItemRemaining,
};