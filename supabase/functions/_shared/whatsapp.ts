const MAX_ERROR_LENGTH = 700;

function whatsappConfig() {
  return {
    token: Deno.env.get('WHATSAPP_TOKEN') ?? '',
    phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '',
    recipient: (Deno.env.get('WHATSAPP_NOTIFY_TO') ?? '').replace(/\D/g, ''),
    template: Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? '',
    language: Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'pt_BR',
    graphVersion: Deno.env.get('WHATSAPP_GRAPH_API_VERSION') ?? '',
  };
}

export async function dispatchWhatsApp(
  adminClient: any,
  notificationId: string,
  order: Record<string, unknown>,
  services: string[],
) {
  const { data: existingNotification } = await adminClient
    .from('notification_outbox').select('status,updated_at').eq('id', notificationId).maybeSingle();
  if (existingNotification?.status === 'sent') {
    return { status: 'sent', message: 'Esta notificação já foi enviada.' };
  }
  if (existingNotification?.status === 'sending') {
    const lockAge = Date.now() - new Date(existingNotification.updated_at).getTime();
    if (Number.isFinite(lockAge) && lockAge < 2 * 60_000) {
      return { status: 'not_claimed', message: 'Esta notificação já está em processamento.' };
    }
    // O claim SQL poderá recuperar um lock antigo caso uma execução tenha sido interrompida.
  }

  const cfg = whatsappConfig();
  const configured = Boolean(
    cfg.token && cfg.phoneNumberId && cfg.recipient && cfg.template && cfg.graphVersion,
  );

  if (!configured) {
    const reason = 'WhatsApp Cloud API não configurada. Use o link wa.me do painel para envio manual.';
    await adminClient.from('notification_outbox').update({
      status: 'manual_required', last_error: reason, next_attempt_at: null,
    }).eq('id', notificationId);
    return { status: 'manual_required', message: reason };
  }

  const { data: attemptNumber, error: claimError } = await adminClient.rpc(
    'claim_whatsapp_notification', { p_notification_id: notificationId },
  );
  if (claimError) throw new Error(`Não foi possível reservar a notificação: ${claimError.message}`);
  if (!attemptNumber) return { status: 'not_claimed', message: 'Notificação já enviada, em processamento ou aguardando nova tentativa.' };

  const textParams = [
    String(order.order_number ?? ''),
    String(order.customer_name ?? ''),
    String(order.customer_company || 'Não informada'),
    String(order.customer_phone ?? ''),
    services.join(', '),
    String(order.description ?? ''),
    String(order.location_address ?? ''),
    String(order.status ?? 'novo').toUpperCase(),
  ];

  let responseReceived = false;
  let deliveryUncertain = false;
  let messageId: string | null = null;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cfg.recipient,
          type: 'template',
          template: {
            name: cfg.template,
            language: { code: cfg.language },
            components: [{
              type: 'body',
              parameters: textParams.map((text) => ({ type: 'text', text: text.slice(0, 1024) })),
            }],
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    responseReceived = true;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerError = result?.error?.message || `WhatsApp API respondeu HTTP ${response.status}`;
      if (response.status >= 500) deliveryUncertain = true;
      throw new Error(providerError);
    }
    messageId = result?.messages?.[0]?.id ?? null;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, MAX_ERROR_LENGTH);
    // Timeout, erro de rede ou HTTP 5xx podem ocorrer após a Meta aceitar a mensagem.
    const uncertain = deliveryUncertain || !responseReceived;
    const delayMinutes = Math.min(60, 2 ** Math.min(Number(attemptNumber), 6));
    const safeMessage = uncertain
      ? `${message}. Resultado de entrega indeterminado; confirme no WhatsApp antes de reenviar.`
      : message;
    const { error: updateError } = await adminClient.from('notification_outbox').update({
      status: uncertain ? 'manual_required' : 'failed',
      last_error: safeMessage,
      next_attempt_at: uncertain ? null : new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    }).eq('id', notificationId);
    if (updateError) console.error('Falha ao persistir estado da notificação:', updateError.message);
    const { error: attemptError } = await adminClient.from('notification_attempts').insert({
      notification_id: notificationId, attempt_number: attemptNumber,
      outcome: uncertain ? 'manual_required' : 'failed', error_message: safeMessage,
    });
    if (attemptError) console.error('Falha ao registrar tentativa WhatsApp:', attemptError.message);
    return { status: uncertain ? 'manual_required' : 'failed', message: safeMessage };
  }

  // A resposta 2xx confirma aceitação pelo provedor. Não rebaixamos esse resultado
  // para failed se apenas o registro secundário da tentativa falhar.
  const { error: sentUpdateError } = await adminClient.from('notification_outbox').update({
    status: 'sent', provider_message_id: messageId, sent_at: new Date().toISOString(),
    last_error: null, next_attempt_at: null,
  }).eq('id', notificationId);
  if (sentUpdateError) {
    const safeMessage = `A Meta aceitou a mensagem, mas não foi possível confirmar o registro local: ${sentUpdateError.message}. Confira o WhatsApp antes de qualquer reenvio.`.slice(0, MAX_ERROR_LENGTH);
    const { error: fallbackUpdateError } = await adminClient.from('notification_outbox').update({
      status: 'manual_required', last_error: safeMessage, next_attempt_at: null,
    }).eq('id', notificationId);
    if (fallbackUpdateError) console.error('Falha ao marcar notificação para conferência manual:', fallbackUpdateError.message);
    const { error: attemptError } = await adminClient.from('notification_attempts').insert({
      notification_id: notificationId, attempt_number: attemptNumber,
      outcome: 'manual_required', provider_message_id: messageId, error_message: safeMessage,
    });
    if (attemptError) console.error('Falha ao registrar aceitação ambígua:', attemptError.message);
    return { status: 'manual_required', message: safeMessage };
  }

  const { error: attemptError } = await adminClient.from('notification_attempts').insert({
    notification_id: notificationId, attempt_number: attemptNumber,
    outcome: 'sent', provider_message_id: messageId,
  });
  if (attemptError) console.error('Mensagem enviada, mas não foi possível registrar tentativa:', attemptError.message);
  return { status: 'sent', providerMessageId: messageId };

}
