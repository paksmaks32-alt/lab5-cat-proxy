# ЛР5: кешуючий проксі-сервер для http.cat

Запуск: npm start  (node main.js -h 127.0.0.1 -p 3000 -c cache)

GET /418    — картинка з кешу або з https://http.cat (заголовок X-Cache-Source)
PUT /500    — записати власну картинку з тіла запиту (201)
DELETE /500 — видалити картинку з кешу (200 або 404)

Команди curl — у test.txt, колекція Postman — у lab5-cat-proxy.postman_collection.json