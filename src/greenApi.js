export async function sendMessage(credentials, chatId, message) {
  return request('/api/green/send', { credentials, chatId, message });
}

export async function getMessage(credentials, chatId, idMessage) {
  return request('/api/green/message', { credentials, chatId, idMessage });
}

export async function getChats(credentials) {
  return request('/api/green/chats', { credentials });
}

export async function receiveNotification(credentials) {
  return request('/api/green/receive', { credentials, receiveTimeout: 5 });
}

export async function deleteNotification(credentials, receiptId) {
  return request('/api/green/delete', { credentials, receiptId });
}

async function request(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `GREEN-API вернул ${response.status}.`);
  }

  return data;
}
