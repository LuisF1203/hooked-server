import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

// Initialize Shopify API
const shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_CLIENT_ID,
    apiSecretKey: process.env.SHOPIFY_CLIENT_SECRET,
    scopes: ["read_products", "write_products"],
    hostName: process.env.SHOPIFY_STORE_DOMAIN,
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
function getRestClient() {
    if (!accessToken) {
        throw new Error("No access token available. Please complete OAuth first.");
    }

    return new shopify.clients.Rest({
        session: {
            shop: process.env.SHOPIFY_STORE_DOMAIN,
            accessToken: accessToken,
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
