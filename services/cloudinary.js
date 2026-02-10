import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
// Credentials should be in .env
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload a file buffer to Cloudinary using streams
 * @param {Buffer} buffer - File buffer
 * @param {Object} options - Upload options (folder, resource_type, etc.)
 * @returns {Promise<Object>} - Cloudinary upload result
 */
export const uploadStream = (buffer, options = {}) => {
    return new Promise((resolve, reject) => {
        const uploadOptions = {
            resource_type: "auto", // Automatically detect image or video
            folder: "hoop_community_uploads",
            ...options
        };

        // Handle Filter Transformation
        if (options.filter && options.filter !== 'none') {
            let transformation = [];
            switch (options.filter) {
                case 'sepia':
                    transformation.push({ effect: "sepia" });
                    break;
                case 'bw':
                    transformation.push({ effect: "blackwhite" });
                    break;
                case 'retro':
                    // Retro look: Sepia + Vignette + Noise (simulated)
                    transformation.push({ effect: "sepia:50" });
                    transformation.push({ effect: "vignette:50" });
                    break;
            }
            if (transformation.length > 0) {
                uploadOptions.transformation = transformation;
            }
            // Remove filter from options to avoid sending it as a raw param if not needed
            delete uploadOptions.filter;
        }

        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
            if (error) {
                console.error("Cloudinary Upload Error:", error);
                return reject(error);
            }
            resolve(result);
        });

        stream.end(buffer);
    });
};

export default cloudinary;
