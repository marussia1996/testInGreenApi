import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteNotification, getChats, getMessage, receiveNotification, sendMessage } from './greenApi';
import { applyOutgoingStatus, isHistoricalNotification, mergeFetchedMessage, parseIncomingMessage } from './notifications';

const STORAGE_KEY = 'green-api-telegram-chat-state';

const initialState = {
  credentials: {
    apiUrl: 'https://api.green-api.com',
    idInstance: '',
    apiTokenInstance: '',
  },
  chats: [],
  activeChatId: '',
  messages: [],
};

function normalizeChatId(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('@') || trimmed.startsWith('-')) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');
  return digits || trimmed;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function App() {
  const restored = useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved ? { ...initialState, ...saved } : initialState;
    } catch {
      return initialState;
    }
  }, []);

  const [credentials, setCredentials] = useState(restored.credentials);
  const [chats, setChats] = useState(restored.chats);
  const [activeChatId, setActiveChatId] = useState(restored.activeChatId);
  const [messages, setMessages] = useState(restored.messages);
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState('');
  const [isPolling, setIsPolling] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [lastNotification, setLastNotification] = useState(null);
  const [status, setStatus] = useState('Введите данные Telegram-инстанса GREEN-API.');
  const chatEndRef = useRef(null);
  const checkingRef = useRef(false);
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const seenIncomingRef = useRef(new Set(restored.messages.map((message) => JSON.stringify([message.chatId, String(message.id)]))));
  const loadingMessageRef = useRef(false);
  const visibleSinceRef = useRef(Math.floor(Date.now() / 1000) * 1000);
  const backgroundNotificationsRef = useRef([]);

  const visibleMessages = messages.filter((message) => !message.statusOnly);
  const visibleChats = chats;
  const activeMessages = visibleMessages.filter((message) => message.chatId === activeChatId).sort((a, b) => a.timestamp - b.timestamp);
  const canUseApi = credentials.apiUrl && credentials.idInstance && credentials.apiTokenInstance;

  useEffect(() => {
    setChats((current) => current.map((chat) =>
      chat.chatId === activeChatId && chat.unreadCount ? { ...chat, unreadCount: 0 } : chat,
    ));
  }, [activeChatId]);

  useEffect(() => {
    if (!canUseApi) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const list = await getChats(credentials);
        if (!Array.isArray(list)) throw new Error('Некорректный список диалогов.');
        if (!cancelled) setChats((current) => {
          const result = [...current];
          for (const item of list) {
            if (item.chatId == null) continue;
            const chatId = String(item.chatId);
            const index = result.findIndex((chat) => chat.chatId === chatId);
            if (index < 0) result.push({ chatId, title: item.name || chatId });
            else if (item.name) result[index] = { ...result[index], title: item.name };
          }
          return result;
        });
      } catch (error) {
        if (!cancelled) setStatus(`Не удалось загрузить диалоги: ${error.message}`);
      }
    }, 600);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [credentials, canUseApi]);

  useEffect(() => {
    if (visibleChats.length && !visibleChats.some((chat) => chat.chatId === activeChatId)) {
      setActiveChatId(visibleChats[0].chatId);
    }
  }, [activeChatId, chats, messages]);

  useEffect(() => {
    if (!canUseApi || loadingMessageRef.current) return;
    const target = messages.find((message) => message.timestamp >= visibleSinceRef.current && message.statusOnly && !message.loadError);
    if (!target) return;
    // Fetch one message at a time while the notification queue continues independently.
    loadMessageText(target);
  }, [messages, activeChatId, credentials, canUseApi]);

  async function loadMessageText(target) {
    if (loadingMessageRef.current || !canUseApi) return;
    loadingMessageRef.current = true;
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 1100));
      const data = await getMessage(credentials, target.chatId, String(target.id));
      mergeFetchedMessage([target], target, data);
      setMessages((current) => mergeFetchedMessage(current, target, data));
    } catch (error) {
      setStatus(`Не удалось загрузить сообщение: ${error.message}`);
      setMessages((current) => current.map((message) =>
        message.chatId === target.chatId && String(message.id) === String(target.id)
          ? { ...message, loadError: error.message }
          : message,
      ));
    } finally {
      loadingMessageRef.current = false;
    }
  }

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        credentials,
        chats,
        activeChatId,
        messages,
      }),
    );
  }, [credentials, chats, activeChatId, messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChatId, activeMessages.length]);

  useEffect(() => {
    if (!isPolling || !canUseApi) {
      return undefined;
    }

    let cancelled = false;

    async function poll() {
      if (!cancelled) {
        await checkNotification({ silentEmpty: true, shouldContinue: () => !cancelled });
        if (!cancelled) timeoutId = window.setTimeout(poll, 500);
      }
    }

    let timeoutId;
    poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [credentials, isPolling, canUseApi]);

  function handleNotification(notification) {
    if (isHistoricalNotification(notification, visibleSinceRef.current)) {
      const body = notification.body;
      const chatId = body.senderData?.chatId || body.chatId || body.chatData?.chatId;
      if (chatId != null) setChats((current) => ensureChat(current, String(chatId), body.senderData?.chatName || body.senderData?.senderName));
      // Acknowledge backlog without changing messages, status or scroll position.
      backgroundNotificationsRef.current.push(notification);
      return false;
    }
    setLastNotification(notification || null);

    if (!notification) {
      setStatus('Очередь GREEN-API пуста.');
      return false;
    }

    const body = notification.body || {};
    const eventChatId = body.senderData?.chatId || body.chatId || body.chatData?.chatId;
    if (eventChatId != null && String(eventChatId)) {
      const chatId = String(eventChatId);
      setChats((current) => ensureChat(current, chatId, body.senderData?.chatName || body.senderData?.senderName));
      setActiveChatId((current) => current || chatId);
    }
    if (body.typeWebhook === 'outgoingMessageStatus') {
      setMessages((current) => applyOutgoingStatus(current, body));
      return false;
    }

    const incoming = parseIncomingMessage(notification);

    if (!incoming) {
      const typeWebhook = notification.body?.typeWebhook || 'unknown';
      const typeMessage = notification.body?.messageData?.typeMessage || 'unknown';
      setStatus(`Получено уведомление ${typeWebhook}/${typeMessage}, текстовое сообщение не найдено.`);
      return false;
    }

    const incomingKey = JSON.stringify([incoming.chatId, String(incoming.id)]);
    if (seenIncomingRef.current.has(incomingKey)) return false;
    seenIncomingRef.current.add(incomingKey);

    setMessages((current) => {
      if (current.some((message) => message.chatId === incoming.chatId && String(message.id) === String(incoming.id))) {
        return current;
      }

      return [...current, incoming];
    });
    setChats((current) => ensureChat(current, incoming.chatId, incoming.senderName).map((chat) =>
      chat.chatId === incoming.chatId && activeChatIdRef.current !== incoming.chatId
        ? { ...chat, unreadCount: (chat.unreadCount || 0) + 1 }
        : chat,
    ));
    setActiveChatId((current) => current || incoming.chatId);
    setStatus(`Получено входящее сообщение (GREEN-API).`);

    return true;
  }

  async function checkNotification(options = {}) {
    const { silentEmpty = false, shouldContinue = () => true } = options;

    if (checkingRef.current) return;

    if (!canUseApi) {
      setStatus('Заполните apiUrl, idInstance и apiTokenInstance.');
      return;
    }

    checkingRef.current = true;
    setIsChecking(true);

    try {
      // Drain service events too, so statuses do not hide incoming messages.
      for (let count = 0; count < 50 && shouldContinue(); count += 1) {
        const notification = await receiveNotification(credentials);
        if (!notification) {
          if (count === 0) {
            setStatus(silentEmpty
              ? 'Новых уведомлений пока нет.'
              : 'Очередь пуста. Проверьте incomingWebhook=yes и пустой webhookUrl в настройках инстанса, если входящие не приходят.');
          }
          break;
        }
        handleNotification(notification);
        if (notification.receiptId == null) {
          throw new Error('В уведомлении отсутствует receiptId: подтвердить обработку невозможно.');
        }
        const result = await deleteNotification(credentials, notification.receiptId);
        if (result?.result === false) {
          throw new Error('GREEN-API не подтвердил удаление уведомления из очереди.');
        }
      }
    } catch (error) {
      setStatus(error.message);
    } finally {
      if (backgroundNotificationsRef.current.length) {
        // Separate storage keeps the backlog out of React's rendering and visible history.
        try {
          const key = `${STORAGE_KEY}-background-${credentials.idInstance}`;
          const saved = JSON.parse(localStorage.getItem(key) || '[]');
          localStorage.setItem(key, JSON.stringify([...saved, ...backgroundNotificationsRef.current].slice(-5000)));
          backgroundNotificationsRef.current = [];
        } catch {
          // Keep the pending archive in memory if browser storage is full.
        }
      }
      checkingRef.current = false;
      setIsChecking(false);
    }
  }

  function updateCredential(field, value) {
    setCredentials((current) => ({ ...current, [field]: value }));
  }

  function createChat(event) {
    event.preventDefault();
    const chatId = normalizeChatId(recipient);

    if (!chatId) {
      setStatus('Введите телефон или chatId получателя.');
      return;
    }

    setChats((current) => {
      const next = ensureChat(current, chatId, chatId);
      return next.map((chat) => chat.chatId === chatId ? { ...chat, manual: true } : chat);
    });
    setActiveChatId(chatId);
    setRecipient('');
    setStatus(`Чат ${chatId} готов к отправке сообщений.`);
  }

  async function handleSend(event) {
    event.preventDefault();
    const text = draft.trim();

    if (!activeChatId || !text || !canUseApi) {
      setStatus('Выберите чат, заполните данные GREEN-API и напишите сообщение.');
      return;
    }

    const optimisticId = `local-${Date.now()}`;
    const outgoing = {
      id: optimisticId,
      chatId: activeChatId,
      text,
      direction: 'out',
      timestamp: Date.now(),
      status: 'sending',
    };

    setDraft('');
    setMessages((current) => [...current, outgoing]);
    setIsSending(true);
    setStatus('Отправляю сообщение...');

    try {
      const response = await sendMessage(credentials, activeChatId, text);
      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticId
            ? { ...message, id: response?.idMessage || optimisticId, status: 'sent' }
            : message,
        ),
      );
      setStatus('Сообщение отправлено в Telegram через GREEN-API.');
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === optimisticId ? { ...message, status: 'failed' } : message,
        ),
      );
      setStatus(error.message);
    } finally {
      setIsSending(false);
    }
  }

  function clearLocalData() {
    setChats([]);
    setMessages([]);
    setActiveChatId('');
    setLastNotification(null);
    setStatus('Локальная история очищена.');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <section className="brand">
          <div className="brand-mark">T</div>
          <div>
            <h1>Telegram Chat</h1>
            <p>GREEN-API client</p>
          </div>
        </section>

        <section className="notice">
          <strong>Сценарий по ТЗ</strong>
          <span>
            Введите данные GREEN-API, создайте чат по телефону или chatId, отправьте текст и
            получите ответ в этом окне.
          </span>
        </section>

        <section className="panel">
          <h2>Инстанс</h2>
          <label>
            API URL
            <input
              value={credentials.apiUrl}
              onChange={(event) => updateCredential('apiUrl', event.target.value)}
              placeholder="https://api.green-api.com"
            />
          </label>
          <label>
            idInstance
            <input
              value={credentials.idInstance}
              onChange={(event) => updateCredential('idInstance', event.target.value)}
              inputMode="numeric"
              placeholder="1101000000"
            />
          </label>
          <label>
            apiTokenInstance
            <input
              value={credentials.apiTokenInstance}
              onChange={(event) => updateCredential('apiTokenInstance', event.target.value)}
              type="password"
              placeholder="token"
            />
          </label>
          <button
            className={isPolling ? 'secondary active' : 'secondary'}
            type="button"
            disabled={!canUseApi}
            onClick={() => setIsPolling((current) => !current)}
          >
            {isPolling ? 'Остановить получение' : 'Получать сообщения'}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={!canUseApi || isChecking}
            onClick={() => checkNotification()}
          >
            {isChecking ? 'Проверяю...' : 'Проверить уведомление'}
          </button>
        </section>

        <section className="panel">
          <h2>Новый чат</h2>
          <form className="row-form" onSubmit={createChat}>
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="Телефон или chatId"
            />
            <button type="submit" aria-label="Создать чат">
              +
            </button>
          </form>
        </section>

        <section className="chat-list" aria-label="Список чатов">
          {visibleChats.length === 0 ? (
            <p className="empty">Создайте чат вручную или включите получение сообщений.</p>
          ) : (
            visibleChats.map((chat) => (
              <button
                className={chat.chatId === activeChatId ? 'chat-item selected' : 'chat-item'}
                key={chat.chatId}
                type="button"
                onClick={() => setActiveChatId(chat.chatId)}
              >
                <span className="chat-title-row">
                  <span>{chat.title}</span>
                  {chat.unreadCount > 0 && (
                    <span className="unread-badge" aria-label={`Непрочитанных сообщений: ${chat.unreadCount}`}>
                      {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                    </span>
                  )}
                </span>
                <small>{chat.chatId}</small>
              </button>
            ))
          )}
        </section>
      </aside>

      <section className="chat-window">
        <header className="chat-header">
          <div>
            <p className="eyebrow">{isPolling ? 'green-api polling' : 'manual mode'}</p>
            <h2>{activeChatId || 'Выберите или создайте чат'}</h2>
          </div>
          <button className="ghost" type="button" onClick={clearLocalData}>
            Очистить
          </button>
        </header>

        <div className="messages" aria-live="polite">
          {activeMessages.length === 0 ? (
            <div className="empty-state">
              <strong>Нет сообщений</strong>
              <span>Отправленные и входящие текстовые сообщения появятся здесь.</span>
            </div>
          ) : (
            activeMessages.map((message) => (
              <article className={`message ${message.direction}`} key={message.id}>
                {message.statusOnly ? (
                  <div>
                    <p>Уведомление об исходящем сообщении</p>
                    <small>ID: {message.id}</small>
                    <p>{message.loadError || 'Загружаю сообщение через GetMessage…'}</p>
                    {message.loadError && <button type="button" disabled={!canUseApi} onClick={() => loadMessageText(message)}>Повторить загрузку</button>}
                  </div>
                ) : <p>{message.text}</p>}
                <footer>
                  <time>{formatTime(message.timestamp)}</time>
                  {message.direction === 'out' && <span>{message.status}</span>}
                </footer>
              </article>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        <p className="status-line">{status}</p>

        {lastNotification && (
          <details className="debug-panel">
            <summary>Последнее уведомление GREEN-API</summary>
            <pre>{JSON.stringify(lastNotification, null, 2)}</pre>
          </details>
        )}

        <form className="composer" onSubmit={handleSend}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Напишите текстовое сообщение"
            rows="1"
          />
          <button type="submit" disabled={isSending || !draft.trim() || !activeChatId}>
            {isSending ? '...' : 'Отправить'}
          </button>
        </form>
      </section>
    </main>
  );
}

function ensureChat(chats, chatId, title) {
  if (!chatId || chats.some((chat) => chat.chatId === chatId)) {
    return chats;
  }

  return [{ chatId, title: title || chatId }, ...chats];
}

export default App;
