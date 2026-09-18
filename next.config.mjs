import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // the app runs COMPILED here, matching what the unit-compiled/browser-compiled projects test
  reactCompiler: true,
  // fumadocs LLMs integration: /docs/<page>.md serves the page as raw markdown for AI agents.
  async rewrites() {
    return [
      {
        source: '/docs/:path*.md',
        destination: '/llms.mdx/docs/:path*',
      },
    ];
  },
};

export default withMDX(config);
