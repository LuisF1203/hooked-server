import "dotenv/config";
import express from "express";
import cors from "cors";
import shopifyRoutes from "./routes/shopify.js";

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));
app.options(/.*/, cors());

// Shopify API routes
app.use("/shopify", shopifyRoutes);

app.listen(3000, () => {
    console.log("Server started on port 3000");
    console.log("✅ Servidor listo. Asegúrate de tener SHOPIFY_ACCESS_TOKEN en .env");
});

app.get("/", (req, res) => {
    res.send("HOLA DESDE EL SERVIDOR!");
});

app.get("/order/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const order = await prisma.order.findUnique({
            where: { shopifyId: id },
            include: {
                customer: true,
                items: true
            }
        });

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        // Fetch user_media_urls metafield AND product images for each product
        const { getProductMetafields, getProduct } = await import("./services/shopify.js");

        for (const item of order.items) {
            if (item.shopifyProductId) {
                try {
                    // Fetch product details from Shopify to get the image
                    const product = await getProduct(item.shopifyProductId);

                    // Add the featured image to the item
                    if (product && product.image) {
                        item.image = product.image.src;
                    } else if (product && product.images && product.images.length > 0) {
                        item.image = product.images[0].src;
                    } else {
                        item.image = null;
                    }

                    // Fetch user_media_urls metafield
                    const metafields = await getProductMetafields(item.shopifyProductId);
                    const urlsMetafield = metafields.find(
                        m => m.namespace === "custom" && m.key === "user_media_urls"
                    );

                    if (urlsMetafield && urlsMetafield.value) {
                        item.user_media_urls = JSON.parse(urlsMetafield.value);
                    } else {
                        item.user_media_urls = [];
                    }
                } catch (e) {
                    console.warn(`Could not fetch data for product ${item.shopifyProductId}:`, e);
                    item.image = null;
                    item.user_media_urls = [];
                }
            }
        }

        res.json(order);
    } catch (error) {
        console.error("Error fetching order:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

// Debug: Print loaded DATABASE_URL (first 50 chars only for security)
console.log("DATABASE_URL loaded:", process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 50) + "..." : "UNDEFINED");

if (!process.env.DATABASE_URL) {
    console.error("CRITICAL ERROR: DATABASE_URL is not defined in .env");
    process.exit(1);
}

// Use standard pg Pool instead of Neon serverless
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

app.post("/webhook/newPaidOrder", async (req, res) => {
    console.log("Webhook received");
    const body = req.body;

    if (!body || Object.keys(body).length === 0) {
        console.error("Empty webhook body received");
        return res.status(400).json({ error: "Empty body" });
    }

    const { id, total_price, currency, customer, line_items, total_price_set } = body;

    try {
        // 1. Upsert Customer
        const savedCustomer = await prisma.customer.upsert({
            where: { shopifyId: String(customer.id) },
            update: {
                firstName: customer.first_name,
                lastName: customer.last_name,
                email: customer.email,
            },
            create: {
                shopifyId: String(customer.id),
                firstName: customer.first_name,
                lastName: customer.last_name,
                email: customer.email,
            },
        });

        // 2. Create Order
        const savedOrder = await prisma.order.create({
            data: {
                shopifyId: String(id),
                totalPrice: total_price,
                currency: currency || total_price_set?.shop_money?.currency_code || "MXN",
                customerId: savedCustomer.id,
            },
        });

        // 3. Process Line Items (Split by Quantity)
        for (const item of line_items) {
            const quantity = item.quantity || item.current_quantity || 1;

            for (let i = 0; i < quantity; i++) {
                await prisma.purchasedItem.create({
                    data: {
                        name: item.title || item.name,
                        shopifyProductId: String(item.product_id),
                        price: item.price,
                        orderId: savedOrder.id,
                    },
                });
            }
        }

        console.log(`Order ${savedOrder.id} processed successfully.`);
        res.json({ message: "Order processed" });
    } catch (error) {
        console.error("Error processing webhook:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});