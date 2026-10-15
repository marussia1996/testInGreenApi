export function mergeFetchedMessage(messages, target, data) {
  if (!data || !['incoming', 'outgoing'].includes(data.type)) {
    throw new Error('GREEN-API не вернул сообщение.');
  }
  return messages.map((message) => message.chatId === target.chatId && String(message.id) === String(target.id)
    ? {
      ...message,
      text: data.textMessage || data.caption || `Сообщение: ${data.typeMessage || 'неизвестный тип'}`,
      direction: data.type === 'incoming' ? 'in' : 'out',
      timestamp: data.timestamp ? data.timestamp * 1000 : message.timestamp,
      status: message.status || data.statusMessage,
      statusOnly: false,
      loadError: '',
    }
    : message);
}

export function applyOutgoingStatus(messages, body) {
  if (body.chatId == null || body.idMessage == null) return messages;
  const chatId = String(body.chatId);
  const id = String(body.idMessage);
  const existing = messages.find((message) => message.chatId === chatId && String(message.id) === id);
  if (existing) {
    return messages.map((message) => message === existing ? { ...message, status: body.status } : message);
  }
  return [...messages, {
    id,
    chatId,
    text: '',
    direction: 'out',
    status: body.status,
    timestamp: body.timestamp ? body.timestamp * 1000 : Date.now(),
    statusOnly: true,
  }];
}

export function parseIncomingMessage(notification) {
  const body = notification?.body || {};
  const messageData = body.messageData || {};
  const text =
    messageData?.textMessageData?.textMessage ||
    messageData?.extendedTextMessageData?.text ||
    messageData?.quotedMessage?.textMessage ||
    messageData?.textMessage ||
    body?.message ||
    '';

  const chatId =
    body?.senderData?.chatId ||
    body?.senderData?.sender ||
    body?.chatId ||
    body?.chatData?.chatId ||
    '';

  const isIncoming = !body.typeWebhook || body.typeWebhook === 'incomingMessageReceived';
  const isText = !messageData.typeMessage || ['textMessage', 'extendedTextMessage', 'quotedMessage'].includes(messageData.typeMessage);

  if (!isIncoming || !isText || !text || !chatId) {
    return null;
  }

  return {
    id: body.idMessage || `${chatId}-${Date.now()}-${Math.random()}`,
    chatId: String(chatId),
    text,
    direction: 'in',
    timestamp: body.timestamp ? body.timestamp * 1000 : Date.now(),
    status: 'received',
    senderName: body.senderData?.senderName || body.senderData?.chatName || 'Собеседник',
  };
}

export function isHistoricalNotification(notification, visibleSince) {
  const timestamp = Number(notification?.body?.timestamp);
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp * 1000 < visibleSince;
}
