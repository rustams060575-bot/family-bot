/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // SDK провайдеров и Telegraf работают на сервере как есть, без бандлинга.
    serverComponentsExternalPackages: ["groq-sdk", "openai", "telegraf"],
  },
};

export default nextConfig;
