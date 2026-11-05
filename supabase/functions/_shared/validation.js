export const SERVICE_NAMES = [
  'Instalações e Manutenções Elétricas',
  'Montagem de Quadros Elétricos',
  'Redes de Dados e Racks',
  'Detecção de Incêndio',
  'Automação Industrial',
  'Outro serviço / avaliação técnica',
];

export const CONTACT_PREFERENCES = ['whatsapp', 'telefone', 'email'];

export function validateOrderPayload(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['Dados da solicitação inválidos.'] };
  }

  const value = {
    name: String(input.name ?? '').trim(),
    company: String(input.company ?? '').trim(),
    phone: String(input.phone ?? '').trim(),
    email: String(input.email ?? '').trim().toLowerCase(),
    address: String(input.address ?? '').trim(),
    contactPreference: String(input.contactPreference ?? '').trim().toLowerCase(),
    description: String(input.description ?? '').trim(),
    services: Array.isArray(input.services)
      ? [...new Set(input.services.map((item) => String(item).trim()).filter(Boolean))]
      : [],
  };

  if (value.name.length < 3 || value.name.length > 160) errors.push('Informe o nome completo (3 a 160 caracteres).');
  if (value.company.length > 160) errors.push('O nome da empresa deve ter até 160 caracteres.');
  const phoneDigits = value.phone.replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 13) errors.push('Informe um telefone/WhatsApp válido com DDD.');
  if (value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.push('Informe um e-mail válido.');
  if (value.address.length < 5 || value.address.length > 500) errors.push('Informe o endereço ou local da execução.');
  if (!CONTACT_PREFERENCES.includes(value.contactPreference)) errors.push('Selecione uma preferência de contato válida.');
  if (value.description.length < 10 || value.description.length > 5000) errors.push('A descrição deve ter entre 10 e 5.000 caracteres.');
  if (value.services.length < 1 || value.services.length > SERVICE_NAMES.length) errors.push('Selecione pelo menos um serviço.');
  if (value.services.some((name) => !SERVICE_NAMES.includes(name))) errors.push('Um ou mais serviços selecionados são inválidos.');
  if (input.consent !== true) errors.push('É necessário aceitar o uso dos dados para o atendimento da solicitação.');

  value.phoneDigits = phoneDigits;
  return { ok: errors.length === 0, errors, value };
}
