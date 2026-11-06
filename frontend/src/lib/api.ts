
export const API = 'https://fabuzada.onrender.com/api';

export const SOCKET =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  'https://fabuzada.onrender.com';

export const getToken = () =>
  typeof window === 'undefined'
    ? ''
    : localStorage.getItem('fabuzada_token') || '';

export async function api(
  path: string,
  method = 'GET',
  data?: any
): Promise<any> {
  const token = getToken();

  const response = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    ...(data !== undefined
      ? { body: JSON.stringify(data) }
      : {}),
    cache: 'no-store'
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `Erro HTTP ${response.status}`);
  }

  return body;
}

export const time = (value: string) =>
  new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
