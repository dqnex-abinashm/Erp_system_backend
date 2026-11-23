const express = require("express");

const controller = require("./Invoice.controller");

const router = express.Router();

// Create an invoice from a Sales Order (one invoice per Sales Order).
router.post("/from-sales-order", controller.createFromSalesOrder);

// List all invoices.
router.get("/", controller.getAll);

// Get one invoice by ID or invoice number.
router.get("/:id", controller.getById);

module.exports = router;