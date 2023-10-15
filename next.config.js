/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, {isServer}) => {
    // Add a rule to handle the canvas.node binaty module
    config.module.rules.push({ test: /\.node$/, use: 'raw-loader'});

    // Exclude canvas from being processed bt Next.js in the brower
    if(!isServer) config.externals.push('canvas');
    return config;
  }
}

module.exports = nextConfig
