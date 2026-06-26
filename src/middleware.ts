import { type NextRequest, NextResponse } from 'next/server';

/**
 * CORS for the API: accept any origin. Applied to /api/* only.
 *
 * Note: with `Access-Control-Allow-Origin: *` the browser will NOT send
 * credentials (cookies). If cookie-based auth across origins is ever needed,
 * switch to reflecting the request Origin and add `Allow-Credentials: true`.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export function middleware(req: NextRequest) {
  // Preflight: answer directly, no need to hit the route handler.
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
