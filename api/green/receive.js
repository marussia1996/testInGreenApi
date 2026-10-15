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
    const receiveTimeout = Number(body.receiveTimeout || 5);
    const url = new URL(createGreenApiUrl(body.credentials, 'receiveNotification'));
    url.searchParams.set('receiveTimeout', String(Math.min(Math.max(receiveTimeout, 5), 60)));

    const apiResponse = await fetch(url, { method: 'GET' });
    const text = await apiResponse.text();
    const payload = text ? JSON.parse(text) : null;

    res.status(apiResponse.status).json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Ошибка запроса к GREEN-API.' });
  }
}
