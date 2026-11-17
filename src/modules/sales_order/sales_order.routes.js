const express = require('express');
const router = express.Router();
const salesOrderController = require('./sales_order.controller');

router.post('/convert-quote/:quoteId', salesOrderController.convertQuoteToSO);
router.get('/', salesOrderController.getAllSalesOrders);
router.get('/:id', salesOrderController.getSalesOrderById);
router.put('/:id', salesOrderController.updateSalesOrder);

module.exports = router;
