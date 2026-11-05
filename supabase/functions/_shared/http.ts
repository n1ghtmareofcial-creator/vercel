import { createClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function allowedOrigins(): string[] {
  const configured = Deno.env.get('CORS_ALLOWED_ORIGINS');
  return configured
    ? configured.split(',').map((item) => item.trim()).filter(Boolean)
    : DEFAULT_DEV_ORIGINS;
}

export function originIsAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  // Chamadas server-to-server/CLI não enviam Origin.
  if (!origin) return true;
  return allowedOrigins().includes(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedOrigins();
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(request: Request, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function createServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  let defaultSecret = '';
  if (secretKeys) {
    try { defaultSecret = JSON.parse(secretKeys).default ?? ''; } catch { /* variável antiga pode coexistir */ }
  }
  const key = legacyKey || defaultSecret;
  if (!url || !key) throw new Error('Configuração Supabase ausente no backend.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function createUserClient(request: Request) {
  const url = Deno.env.get('SUPABASE_URL');
  const publishable = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  const publishableKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  let defaultKey = '';
  if (publishableKeys) {
    try { defaultKey = JSON.parse(publishableKeys).default ?? ''; } catch { /* usa chave legada */ }
  }
  const key = publishable || defaultKey;
  if (!url || !key) throw new Error('Configuração de autenticação Supabase ausente.');
  return createClient(url, key, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireAdmin(request: Request, adminClient: ReturnType<typeof createServiceClient>) {
  const authorization = request.headers.get('Authorization') ?? '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) throw new Error('Sessão administrativa inválida ou expirada.');
  const userClient = createUserClient(request);
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) throw new Error('Sessão administrativa inválida ou expirada.');

  const { data: admin, error: adminError } = await adminClient
    .from('admin_users')
    .select('user_id, display_name, active')
    .eq('user_id', userData.user.id)
    .eq('active', true)
    .maybeSingle();
  if (adminError || !admin) throw new Error('Este usuário não possui permissão administrativa.');
  return { user: userData.user, admin };
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
