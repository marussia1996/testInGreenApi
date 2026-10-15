import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function createGreenApiUrl(credentials, methodPath) {
  const apiUrl = String(credentials.apiUrl || '').trim().replace(/\/+$/, '');
  const idInstance = String(credentials.idInstance || '').trim();
  const apiTokenInstance = String(credentials.apiTokenInstance || '').trim();

  if (!apiUrl || !idInstance || !apiTokenInstance) {
    throw new Error('Заполните apiUrl, idInstance и apiTokenInstance.');
  }

  const url = new URL(apiUrl);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('apiUrl должен начинаться с http:// или https://.');
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/waInstance${idInstance}/${methodPath}/${apiTokenInstance}`;
}

async function proxyGreenApi(req, res) {
  try {
    const body = await readBody(req);
    const credentials = body.credentials || {};
    let apiResponse;

    if (req.url === '/api/green/send') {
      const message = String(body.message || '').trim();
      const chatId = String(body.chatId || '').trim();

      if (!chatId || !message) {
        sendJson(res, 400, { message: 'Укажите chatId и текст сообщения.' });
        return;
      }

      apiResponse = await fetch(createGreenApiUrl(credentials, 'sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, message }),
      });
    } else if (req.url === '/api/green/chats') {
      apiResponse = await fetch(createGreenApiUrl(credentials, 'getChats'), { method: 'GET' });
    } else if (req.url === '/api/green/message') {
      const chatId = String(body.chatId || '').trim();
      const idMessage = String(body.idMessage || '').trim();
      if (!chatId || !idMessage) {
        sendJson(res, 400, { message: 'Укажите chatId и idMessage.' });
        return;
      }
      apiResponse = await fetch(createGreenApiUrl(credentials, 'getMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, idMessage }),
      });
    } else if (req.url === '/api/green/receive') {
      const receiveTimeout = Number(body.receiveTimeout || 5);
      const url = new URL(createGreenApiUrl(credentials, 'receiveNotification'));
      url.searchParams.set('receiveTimeout', String(Math.min(Math.max(receiveTimeout, 5), 60)));

      apiResponse = await fetch(url, { method: 'GET' });
    } else if (req.url === '/api/green/delete') {
      const receiptId = Number(body.receiptId);

      if (!Number.isFinite(receiptId)) {
        sendJson(res, 400, { message: 'receiptId должен быть числом.' });
        return;
      }

      apiResponse = await fetch(`${createGreenApiUrl(credentials, 'deleteNotification')}/${receiptId}`, {
        method: 'DELETE',
      });
    } else {
      sendJson(res, 404, { message: 'Unknown GREEN-API proxy route.' });
      return;
    }

    const text = await apiResponse.text();
    const payload = text ? JSON.parse(text) : null;
    sendJson(res, apiResponse.status, payload);
  } catch (error) {
    sendJson(res, 500, { message: error.message || 'Ошибка запроса к GREEN-API.' });
  }
}

function greenApiProxyPlugin() {
  return {
    name: 'green-api-telegram-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/green/')) {
          proxyGreenApi(req, res);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), greenApiProxyPlugin()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
