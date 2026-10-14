/**
 * Headers for the web app's HTML and assets. The Vite build writes them to
 * dist/_headers for Cloudflare, and the Node server sends the same values, so
 * the e2e test runs under the production policy.
 *
 * apiOrigin is only needed when the API is hosted on a different origin.
 */
export function webSecurityHeaders(apiOrigin?: string): Record<string, string> {
  const connect = apiOrigin ? `'self' ${apiOrigin}` : "'self'";
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src ${connect}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}
