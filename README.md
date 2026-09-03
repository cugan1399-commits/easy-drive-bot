# auto-school-bot — Кусок 1

## Установка
```
npm install
cp .env.example .env
```

Заполни `.env`:
- `BOT_TOKEN` — токен от @BotFather
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — из Project Settings -> API в Supabase (Service Role Key, не anon!)
- `INSTRUCTOR_TELEGRAM_ID` — твой личный telegram_id (узнать можно у @userinfobot). Это единственный, кто получит is_admin=true при первом /start

## Запуск локально
```
npm start
```

## Что уже работает
- `/start` — новый пользователь: спрашивает имя и телефон, создаёт запись в `users` (инструктору — is_admin=true, всем остальным — обычный студент, привязанный к INSTRUCTOR_TELEGRAM_ID)
- `/start` — старый пользователь: приветствует по имени
- `/stop_notif`, `/start_notif` — вкл/выкл уведомлений о расписании

## Деплой на Render
1. Залить этот код в GitHub-репозиторий
2. New -> Web Service -> подключить репозиторий
3. Build command: `npm install`
4. Start command: `npm start`
5. Вписать те же переменные окружения из `.env` в Render -> Environment
