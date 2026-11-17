// Кешуючий проксі-сервер (ЛР5): картинки котів з https://http.cat.
// GET віддає картинку з кешу або з http.cat, PUT записує власну, DELETE видаляє.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { Command } from 'commander';

// 1. Параметри командного рядка

const program = new Command();

program
  .name('cat-proxy')
  .description('Кешуючий проксі-сервер для картинок з http.cat')
  .helpOption('--help', 'показати довідку') // -h звільняємо для --host
  .requiredOption('-h, --host <address>', 'адреса сервера')
  .requiredOption('-p, --port <number>', 'порт сервера')
  .requiredOption('-c, --cache <path>', 'тека для кешованих картинок');

program.parse();
const options = program.opts();

const port = Number(options.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Порт має бути цілим числом від 0 до 65535, отримано «${options.port}»`);
  process.exit(1);
}

const ALLOWED_METHODS = 'GET, PUT, DELETE';

// 2. Допоміжні функції

// Текстова відповідь (повідомлення про результат або помилку).
function sendText(res, statusCode, message, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(message);
}

// Шлях /404 → '404'; будь-що інше → null.
function parseCode(pathname) {
  const match = pathname.match(/^\/(\d{3})$/);
  return match ? match[1] : null;
}

// 4. Обробник запиту

async function handleRequest(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    sendText(res, 405, `Метод ${req.method} не підтримується`, { Allow: ALLOWED_METHODS });
    return;
  }

  const code = parseCode(pathname);
  if (code === null) {
    sendText(res, 400, `Шлях має містити тризначний код стану, наприклад /404; отримано «${pathname}»`);
    return;
  }

  sendText(res, 501, `Метод ${req.method} ще не реалізовано`); // тимчасово
}

// 5. Запуск: тека кешу, потім сервер

try {
  await fs.mkdir(options.cache, { recursive: true });
} catch (err) {
  console.error(`Не вдалося створити теку кешу «${options.cache}»: ${err.message}`);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendText(res, 500, 'Внутрішня помилка сервера');
  }
});

try {
  server.listen(port, options.host);
  await once(server, 'listening'); // проміс: виконається після запуску або відхилиться з помилкою
  console.log(`Проксі-сервер працює на http://${options.host}:${options.port}, кеш: ${options.cache}`);
} catch (err) {
  console.error(`Не вдалося запустити сервер: ${err.message}`);
  process.exit(1);
}