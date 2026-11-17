// src/modules/supply_chain/shipment/shipment.repository.js

const Q = require('./shipment-code');

// Every function receives a pg client so the service can use one transaction.

const lockShipmentNumber = (client) => client.query(Q.LOCK_SHIPMENT_NUMBER);

const getNextShipmentSeq = async (client) => {
  const { rows } = await client.query(Q.GET_NEXT_SHIPMENT_SEQ);
  return rows[0].next_seq;
};

const getPackageForShipment = async (client, packageId) => {
  const { rows } = await client.query(Q.GET_PACKAGE_FOR_SHIPMENT, [packageId]);
  return rows[0] || null;
};

const getPackageItems = async (client, packageId) => {
  const { rows } = await client.query(Q.GET_PACKAGE_ITEMS, [packageId]);
  return rows;
};

const findActiveShipmentForPackage = async (client, packageId) => {
  const { rows } = await client.query(Q.CHECK_PACKAGE_ALREADY_SHIPPED, [packageId]);
  return rows[0] || null;
};

const getShippablePackages = async (client, customerId) => {
  const { rows } = await client.query(Q.GET_SHIPPABLE_PACKAGES, [customerId]);
  return rows;
};

const createShipment = async (client, s) => {
  const { rows } = await client.query(Q.CREATE_SHIPMENT, [
    s.shipmentNumber,
    s.status,
    s.shipDate,
    s.shippingCharges,
    s.currencyCode,
    s.customerId,
    s.billingAddressId,
    s.shippingAddressId,
    s.carrier,
    s.trackingNumber,
    s.trackingUrl,
    s.isDelivered,
    s.deliveredDate,
    s.sendStatusNotification,
    s.remarks,
    s.packageSlipNumber,
    s.userId,
  ]);
  return rows[0];
};

const createShipmentItem = async (client, shipment, pkg, item, userId) => {
  const { rows } = await client.query(Q.CREATE_SHIPMENT_ITEM, [
    shipment.shipment_id,
    pkg.package_id,
    pkg.package_number,
    pkg.package_slip_number,
    pkg.customer_id,
    item.sales_order_item_id,
    item.item_code,
    item.item_name,
    item.item_description,
    item.item_order_date,
    item.total_quantity,
    item.pack_quantity,
    item.pack_weight,
    item.remarks,
    userId,
  ]);
  return rows[0];
};

const markPackageShipped = (client, packageId, userId) =>
  client.query(Q.MARK_PACKAGE_SHIPPED, [packageId, userId]);

// ---------- list + details ----------
const getAllShipments = async (client) => {
  const { rows } = await client.query(Q.GET_ALL_SHIPMENTS);
  return rows;
};

const getShipmentDetails = async (client, shipmentId) => {
  const { rows } = await client.query(Q.GET_SHIPMENT_DETAILS, [shipmentId]);
  return rows[0] || null;
};

const getShipmentSalesOrders = async (client, shipmentId) => {
  const { rows } = await client.query(Q.GET_SHIPMENT_SALES_ORDERS, [shipmentId]);
  return rows;
};

module.exports = {
  lockShipmentNumber,
  getNextShipmentSeq,
  getPackageForShipment,
  getPackageItems,
  findActiveShipmentForPackage,
  getShippablePackages,
  createShipment,
  createShipmentItem,
  markPackageShipped,
  getAllShipments,
  getShipmentDetails,
  getShipmentSalesOrders,
};