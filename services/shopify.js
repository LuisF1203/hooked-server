import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

// Initialize Shopify API
const shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_CLIENT_ID,
    apiSecretKey: process.env.SHOPIFY_CLIENT_SECRET,
    scopes: [
        "read_products",
        "write_products",
        "read_files",
        "write_files",
        "read_metaobjects",
        "write_metaobjects",
        "read_orders",
        "read_customers"
    ],
    hostName: process.env.HOST || "localhost:3000",
    hostScheme: (process.env.HOST || "localhost:3000").includes("localhost") ? "http" : "https",
    apiVersion: ApiVersion.January26,
    isEmbeddedApp: false,
});

// Store for access tokens (in production, use database)
let accessToken = null;

/**
 * Get the current access token
 */
export function getAccessToken() {
    return accessToken;
}

/**
 * Set the access token (called after OAuth callback)
 */
export function setAccessToken(token) {
    accessToken = token;
}

/**
 * Create REST client for Shopify API calls
 */
/**
 * Create REST client for Shopify API calls
 */
function getRestClient() {
    const token = accessToken || process.env.SHOPIFY_ACCESS_TOKEN;

    if (!token) {
        throw new Error("No access token available. Please complete OAuth first.");
    }

    console.log("🛒 Making Shopify Request:");
    console.log("   Shop:", process.env.SHOPIFY_STORE_DOMAIN);
    console.log("   Token:", token.substring(0, 10) + "..." + token.slice(-4));

    return new shopify.clients.Rest({
        session: {
            shop: process.env.SHOPIFY_STORE_DOMAIN,
            accessToken: token,
        },
    });
}

/**
 * Get all metafields for a product
 * @param {string} productId - Shopify product ID
 */
export async function getProductMetafields(productId) {
    const client = getRestClient();

    const response = await client.get({
        path: `products/${productId}/metafields`,
    });

    return response.body.metafields;
}

/**
 * Create or update a metafield for a product
 * @param {string} productId - Shopify product ID
 * @param {object} metafield - Metafield data
 * @param {string} metafield.namespace - Metafield namespace (e.g., "custom")
 * @param {string} metafield.key - Metafield key
 * @param {string} metafield.value - Metafield value
 * @param {string} metafield.type - Metafield type (e.g., "single_line_text_field", "json", "number_integer")
 */
export async function setProductMetafield(productId, metafield) {
    console.log("📤 Setting Metafield:", JSON.stringify(metafield, null, 2));

    const client = getRestClient();

    const response = await client.post({
        path: `products/${productId}/metafields`,
        data: {
            metafield: {
                namespace: metafield.namespace || "custom",
                key: metafield.key,
                value: metafield.value,
                type: metafield.type || "single_line_text_field",
            },
        },
    });

    console.log("📥 Shopify Response Body:", JSON.stringify(response.body, null, 2));

    return response.body.metafield;
}

/**
 * Update an existing metafield
 * @param {string} metafieldId - Metafield ID
 * @param {object} metafield - Updated metafield data
 */
export async function updateMetafield(metafieldId, metafield) {
    const client = getRestClient();

    const response = await client.put({
        path: `metafields/${metafieldId}`,
        data: {
            metafield: {
                value: metafield.value,
                type: metafield.type,
            },
        },
    });

    return response.body.metafield;
}

/**
 * Delete a metafield
 * @param {string} metafieldId - Metafield ID
 */
export async function deleteMetafield(metafieldId) {
    const client = getRestClient();

    await client.delete({
        path: `metafields/${metafieldId}`,
    });

    return { success: true };
}

/**
 * Get product by ID
 * @param {string} productId - Shopify product ID
 */
export async function getProduct(productId) {
    const client = getRestClient();

    const response = await client.get({
        path: `products/${productId}`,
    });

    return response.body.product;
}

/**
 * Set multiple metafields for a product at once
 * @param {string} productId - Shopify product ID
 * @param {array} metafields - Array of metafield objects
 */
export async function setProductMetafields(productId, metafields) {
    const results = [];

    for (const metafield of metafields) {
        const result = await setProductMetafield(productId, metafield);
        results.push(result);
    }

    return results;
}

// Export shopify instance for OAuth
export { shopify };

/**
 * Upload a file to Shopify (Image or Video)
 * @param {Object} file - File object { name, size, type, buffer } or { url }
 * @returns {Promise<string>} - The Shopify File ID (gid://shopify/File/...)
 */
export async function uploadFileToShopify(file) {
    const token = accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!token) throw new Error("No access token available");

    const client = new shopify.clients.Graphql({
        session: {
            shop: process.env.SHOPIFY_STORE_DOMAIN,
            accessToken: token,
        },
    });

    // 1. Request Staged Upload URL
    // We use GraphQL for this as it's not available in REST
    const stagedUploadQuery = `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
                stagedTargets {
                    url
                    resourceUrl
                    parameters {
                        name
                        value
                    }
                }
                userErrors {
                    field
                    message
                }
            }
        }
    `;

    // Shopify Video only supports MP4 and MOV. WebM must be uploaded as generic FILE.
    console.log("📂 Uploading file:", file.name, "Type:", file.type);

    const isSupportedVideo = file.type === "video/mp4" || file.type === "video/quicktime";
    const resourceType = file.type.startsWith("video/")
        ? (isSupportedVideo ? "VIDEO" : "FILE")
        : "IMAGE";

    console.log("➡️ Decided Resource Type for Shopify:", resourceType);

    const input = {
        resource: resourceType,
        filename: file.name,
        mimeType: file.type,
        fileSize: String(file.size),
        httpMethod: "POST",
    };

    const response = await client.request(stagedUploadQuery, {
        variables: { input: [input] },
    });

    console.log("🔍 GraphQL Response Keys:", Object.keys(response));
    if (response.body) console.log("🔍 Response Body Keys:", Object.keys(response.body));

    // Try to access data from response.body or response directly
    const data = response.body?.data || response.data;

    if (!data) {
        throw new Error("No data received from Shopify GraphQL");
    }

    const stagedTargets = data.stagedUploadsCreate?.stagedTargets;
    if (!stagedTargets || stagedTargets.length === 0) {
        throw new Error("Failed to get staged upload target");
    }

    const target = stagedTargets[0];
    const formData = new FormData();

    // Add parameters required by Shopify
    target.parameters.forEach((param) => {
        formData.append(param.name, param.value);
    });

    // Add the file itself
    const blob = new Blob([file.buffer], { type: file.type });
    formData.append("file", blob);

    // 2. Upload to the Staged URL
    const uploadResponse = await fetch(target.url, {
        method: "POST",
        body: formData,
    });

    if (!uploadResponse.ok) {
        throw new Error(`Failed to upload file to staged URL: ${uploadResponse.statusText}`);
    }

    // 3. Create the File resource in Shopify
    const fileCreateQuery = `
        mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
                files {
                    id
                    fileStatus
                    ... on MediaImage {
                        image {
                            url
                        }
                    }
                    ... on Video {
                        sources {
                            url
                            mimeType
                            format
                        }
                    }
                    ... on GenericFile {
                        url
                    }
                }
                userErrors {
                    field
                    message
                }
            }
        }
    `;

    const fileCreateInput = {
        originalSource: target.resourceUrl,
        contentType: resourceType === "FILE" ? "FILE" : resourceType,
    };

    const createResponse = await client.request(fileCreateQuery, {
        variables: { files: [fileCreateInput] },
    });

    console.log("🔍 File Create Response Keys:", Object.keys(createResponse));

    const createData = createResponse.body?.data || createResponse.data;

    if (!createData) {
        throw new Error("No data received from fileCreate");
    }

    const files = createData.fileCreate?.files;
    if (!files || files.length === 0) {
        const errors = createData.fileCreate?.userErrors;
        throw new Error(`Failed to create file resource: ${JSON.stringify(errors)}`);
    }

    const createdFile = files[0];
    const fileId = createdFile.id;
    console.log(`✅ File uploaded successfully: ${fileId}`);

    // Determine the public URL
    let publicUrl = target.resourceUrl; // Fallback to staged URL

    if (createdFile.image?.url) {
        publicUrl = createdFile.image.url;
    } else if (createdFile.sources && createdFile.sources.length > 0) {
        // Find mp4 if possible
        const mp4Source = createdFile.sources.find(s => s.format === 'mp4' || s.mimeType === 'video/mp4');
        publicUrl = mp4Source ? mp4Source.url : createdFile.sources[0].url;
    } else if (createdFile.url) {
        publicUrl = createdFile.url;
    } else {
        console.warn("⚠️ Could not find public URL in created file response. Using staged URL.");
    }

    if (resourceType === 'VIDEO' && (!createdFile.sources || createdFile.sources.length === 0)) {
        console.warn("⚠️ Video created but sources not yet available (processing?). URL might not be playable immediately.");
    }

    console.log(`🔗 Public URL: ${publicUrl}`);

    // Return both ID and URL for metafield storage
    return {
        fileId,
        url: publicUrl,
        type: file.type
    };
}

/**
 * Verify if a customer has purchased a specific product
 * @param {string} customerId - Shopify Customer ID (numeric or GID)
 * @param {string} productId - Shopify Product ID (numeric or GID)
 * @returns {Promise<{verified: boolean, orderId?: string}>}
 */
export async function verifyCustomerOwnsProduct(customerId, productId) {
    const token = accessToken || process.env.SHOPIFY_ACCESS_TOKEN;
    if (!token) throw new Error("No access token available");

    const client = new shopify.clients.Graphql({
        session: {
            shop: process.env.SHOPIFY_STORE_DOMAIN,
            accessToken: token,
        },
    });

    // Ensure IDs are in GID format
    const customerGid = customerId.toString().startsWith("gid://")
        ? customerId
        : `gid://shopify/Customer/${customerId}`;

    const productGid = productId.toString().startsWith("gid://")
        ? productId
        : `gid://shopify/Product/${productId}`;

    console.log(`🔍 Verifying ownership: Customer ${customerGid} -> Product ${productGid}`);

    const query = `
        query customerOrders($id: ID!) {
            customer(id: $id) {
                orders(first: 50, reverse: true) {
                    edges {
                        node {
                            id
                            lineItems(first: 50) {
                                edges {
                                    node {
                                        product {
                                            id
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const response = await client.request(query, {
            variables: { id: customerGid },
        });

        const data = response.body?.data || response.data;

        if (!data?.customer) {
            console.log("❌ Customer not found");
            return { verified: false };
        }

        const orders = data.customer.orders.edges;

        for (const order of orders) {
            const lineItems = order.node.lineItems.edges;
            const hasProduct = lineItems.some(item => item.node.product?.id === productGid);

            if (hasProduct) {
                console.log(`✅ Verification successful! Found in order ${order.node.id}`);
                return { verified: true, orderId: order.node.id };
            }
        }

        console.log("❌ Product not found in customer's recent orders");
        return { verified: false };

    } catch (error) {
        console.error("Error verifying ownership:", error);
        return { verified: false, error: error.message };
    }
}

/**
 * Verify if an order contains a specific product
 * @param {string} orderId - Shopify Order ID
 * @param {string} productId - Shopify Product ID
 */
export async function verifyOrderContainsProduct(orderId, productId) {
    const client = getRestClient();

    try {
        const response = await client.get({
            path: `orders/${orderId}`,
        });

        const order = response.body.order;
        if (!order) return false;

        // Check if product exists in line items
        // Note: product_id is a number in REST
        const hasProduct = order.line_items.some(item => String(item.product_id) === String(productId));

        console.log(`🔍 Order Verification: Order ${orderId} contains Product ${productId}? ${hasProduct}`);
        return hasProduct;

    } catch (error) {
        console.error("Error verifying order content:", error);
        return false;
    }
}
