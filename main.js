// Кешуючий проксі-сервер (ЛР5): картинки котів з https://http.cat.
// GET віддає картинку з кешу або з http.cat, PUT записує власну, DELETE видаляє.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { Command } from 'commander';
import superagent from 'superagent';

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

const UPSTREAM = 'https://http.cat';
const ALLOWED_METHODS = 'GET, PUT, DELETE';

// 2. Допоміжні функції

// Текстова відповідь (повідомлення про результат або помилку).
function sendText(res, statusCode, message, headers = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(message);
}

// Відповідь з картинкою; source — звідки її взято (cache або http.cat).
function sendImage(res, image, source) {
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'X-Cache-Source': source });
  res.end(image);
}

// Шлях /404 → '404'; будь-що інше → null.
function parseCode(pathname) {
  const match = pathname.match(/^\/(\d{3})$/);
  return match ? match[1] : null;
}

// Повний шлях до файлу картинки в теці кешу.
function cacheFile(code) {
  return path.join(options.cache, `${code}.jpg`);
}

// Запис через тимчасовий файл: інший запит ніколи не побачить файл, записаний наполовину.
async function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, data);
  await fs.rename(temp, file);
}

// Збирає тіло запиту (потік) в один Buffer.
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// 3. Обробники методів

async function handleGet(res, code) {
  const file = cacheFile(code);
  try {
    const image = await fs.readFile(file);
    sendImage(res, image, 'cache');
    return;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // промах кешу — йдемо на http.cat
  }

  let response;
  try {
    response = await superagent.get(`${UPSTREAM}/${code}`).buffer(true).responseType('blob').timeout(10000);
  } catch (err) {
    const reason = err.status ? `http.cat відповів ${err.status}` : `немає зв'язку з http.cat (${err.code ?? err.message})`;
    sendText(res, 404, `Картинку для коду ${code} не знайдено: ${reason}`);
    return;
  }

  await writeAtomic(file, response.body);
  sendImage(res, response.body, 'http.cat');
}

async function handlePut(req, res, code) {
  const image = await readBody(req);
  if (image.length === 0) {
    sendText(res, 400, 'Тіло запиту порожнє: надішліть картинку');
    return;
  }
  await writeAtomic(cacheFile(code), image);
  sendText(res, 201, `Картинку для коду ${code} збережено в кеш`);
}

async function handleDelete(res, code) {
  try {
    await fs.unlink(cacheFile(code));
  } catch (err) {
    if (err.code === 'ENOENT') {
      sendText(res, 404, `Картинки для коду ${code} немає в кеші`);
      return;
    }
    throw err;
  }
  sendText(res, 200, `Картинку для коду ${code} видалено з кешу`);
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

  if (req.method === 'GET') await handleGet(res, code);
  else if (req.method === 'PUT') await handlePut(req, res, code);
  else await handleDelete(res, code);
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