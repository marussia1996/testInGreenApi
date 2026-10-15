function createGreenApiUrl(credentials, methodPath) {
  const apiUrl = String(credentials?.apiUrl || '').trim().replace(/\/+$/, '');
  const idInstance = String(credentials?.idInstance || '').trim();
  const apiTokenInstance = String(credentials?.apiTokenInstance || '').trim();

  if (!apiUrl || !idInstance || !apiTokenInstance) {
    throw new Error('Заполните apiUrl, idInstance и apiTokenInstance.');
  }

  const url = new URL(apiUrl);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('apiUrl должен начинаться с http:// или https://.');
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/waInstance${idInstance}/${methodPath}/${apiTokenInstance}`;
}

function getBody(req) {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

  return req.body || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  try {
    const body = getBody(req);
    const receiptId = Number(body.receiptId);

    if (!Number.isFinite(receiptId)) {
      res.status(400).json({ message: 'receiptId должен быть числом.' });
      return;
    }

    const apiResponse = await fetch(`${createGreenApiUrl(body.credentials, 'deleteNotification')}/${receiptId}`, {
      method: 'DELETE',
    });

    const text = await apiResponse.text();
    const payload = text ? JSON.parse(text) : null;

    res.status(apiResponse.status).json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Ошибка запроса к GREEN-API.' });
  }
}
