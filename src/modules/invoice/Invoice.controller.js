const service = require("./invoice.service");

const sendError = (res, error) => {
    console.error("Invoice API error:", error);

    const status = error.statusCode || (error.code === "23505" ? 409 : 500);

    res.status(status).json({
        success: false,

        message:
            status === 500
                ? "Failed to process invoice request."
                : error.message,

        ...(process.env.NODE_ENV !== "production"
            ? { detail: error.message }
            : {}),
    });
};

// GET /api/v1/invoices  -> plain array for the Invoices table
const getAll = async (req, res) => {
    try {
        const data = await service.list({
            search: req.query.search || "",
            status: req.query.status || "",
        });

        res.status(200).json(data);
    } catch (error) {
        sendError(res, error);
    }
};

// GET /api/v1/invoices/:id  (invoice_id or invoice number)
const getById = async (req, res) => {
    try {
        const data = await service.getById(req.params.id);

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found.",
            });
        }

        res.status(200).json(data);
    } catch (error) {
        sendError(res, error);
    }
};

// POST /api/v1/invoices/from-sales-order   { sales_order_id }
const createFromSalesOrder = async (req, res) => {
    try {
        const { sales_order_id } = req.body;

        if (!sales_order_id) {
            return res.status(400).json({
                success: false,
                message: "Sales Order ID is required.",
            });
        }

        const data = await service.createFromSalesOrder(sales_order_id);

        res.status(201).json({
            success: true,
            message: "Invoice created successfully.",
            data,
        });
    } catch (error) {
        sendError(res, error);
    }
};

module.exports = {
    getAll,
    getById,
    createFromSalesOrder,
};