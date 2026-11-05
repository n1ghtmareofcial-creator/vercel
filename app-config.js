/*
 * Configuração pública do navegador.
 * A publishable/anon key é própria para clientes web quando todas as tabelas usam RLS.
 * NUNCA coloque SUPABASE_SERVICE_ROLE_KEY, tokens Meta ou senhas neste arquivo.
 */
window.CONNECTA_CONFIG = Object.freeze({
  supabaseUrl: '',          // Ex.: https://SEU-PROJETO.supabase.co
  supabaseAnonKey: '',      // Publishable key (sb_publishable_...) ou anon key legada
  businessWhatsAppPhone: '', // Número comercial em formato internacional, somente dígitos: 55DDDNUMERO
  maxFiles: 5,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalFileBytes: 5 * 1024 * 1024,
});
