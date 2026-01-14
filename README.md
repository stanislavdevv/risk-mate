# RiskMate (Shopify embedded app) — README (dev log + spec)

RiskMate — embedded Shopify app (2026 flow) для **deterministic** (rule-based) оценки риска заказов.
Цель MVP: автоматически ставить **risk-level** (LOW/MEDIUM/HIGH), сохранять результат в БД, и делать сайд-эффекты в Shopify:
- tags (`risk:<level>` и/или status tags)
- Order Risk Assessment в заказе (видно в Admin)

Ключевая идея: **никакого AI в ядре** (пока), только прозрачные правила, понятные причины и “trust features” (что случилось, когда и почему).

---

## TL;DR: что уже сделано (актуальное состояние)

### 1) Shopify app (2026 flow)
- Шаблон на **React Router template** (не Remix).
- Авторизация через `authenticate.admin` / `authenticate.webhook` из `shopify.server.ts`.
- Webhooks подключены и работают (orders/create, orders/updated, orders/paid — если включено, app/uninstalled).

### 2) Risk engine (deterministic)
- Rule-based движок, считает `score`, `riskLevel`, `reasonsJson`, `facts`.
- Поддерживаемые типы правил (MVP):
  - `ORDER_VALUE`
  - `FIRST_TIME`
  - `HIGH_QTY`
  - `COUNTRY_MISMATCH`
- Rules CRUD в UI (add / inline edit autosave / toggle / delete).

### 3) Storage (Prisma)
- Prisma используется как основная БД:
  - sessions в Prisma
  - `RiskRule`
  - `RiskResult`
- `RiskResult` имеет “trust features” и идемпотентность на stable-hash:
  - `payloadHash` — SHA1 от “stable fields” payload
  - `lastTopic`, `lastEventAt`, `eventCount`
  - `lastDecision`, `skipReason`
  - (опционально) `lastRiskChangeAt` — когда реально поменялся риск

### 4) Webhook idempotency + trust features
- На вебхуке считаем `payloadHash` только от стабильных полей заказа (без protected data).
- Логика:
  - если `payloadHash` не изменился → **SKIPPED (UNCHANGED)**, но trust-поля обновляем (eventCount/lastEventAt/lastTopic/decision/skipReason).
  - если изменился → пересчёт риска + запись + сайд-эффекты → **APPLIED**.

### 5) Shopify side-effects
- Проставляем risk tags (например `risk:high`) + чистим/обновляем статусные теги (MVP).
- Создаём Order Risk Assessment (видно в заказе).

### 6) UI (без Polaris)
- 3 таба:
  - **Orders**: таблица результатов (risk/score/reasons + trust поля)
  - **Rules**: CRUD правил + seed default rules
  - **Events**: таблица последних webhook событий (решение APPLIED/SKIPPED + ссылка на заказ)
- Есть setup-checklist для пустого магазина.
- Добавлена мультиязычность через словари `app/i18n/strings.ts` (`t(lang, key)` + `parseLang` + `SUPPORTED_LANGS`).

---

## Стек / зависимости

- Node.js (через Shopify CLI / Vite dev)
- React + React Router (Shopify 2026 template)
- Prisma + DB (локально обычно SQLite, в проде можно Postgres)
- Shopify Admin GraphQL API (теги, ассессмент, currencyCode и т.п.)
- Без Polaris (UI на чистом React + inline styles)

---

## Важные файлы/папки (ориентир)

> Пути могут немного отличаться, но логика такая:

- `app/routes/webhooks.tsx`  
  Принимает webhooks, нормализует topic, вычисляет stable hash, вызывает risk engine, пишет в store, делает сайд-эффекты.

- `app/riskmate/riskEngine.server.ts`  
  Deterministic risk engine: берёт payload + rules → возвращает `{ score, riskLevel, reasonsJson, facts }`.

- `app/riskmate/riskStore.server.ts`  
  `upsertRiskIfChanged(...)` — центральное место идемпотентности и trust полей.

- `app/riskmate/shopifyActions.server.ts`  
  Действия в Shopify: теги/очистка/и т.д.

- `app/riskmate/orderRiskAssessment.server.ts`  
  Создание Order Risk Assessment.

- `app/routes/app._index.tsx`  
  UI: табы Orders/Rules/Events + loader/action + i18n.

- `app/i18n/strings.ts`  
  Словари переводов + `t()`, `parseLang()`, `SUPPORTED_LANGS`.

- `prisma/schema.prisma`  
  Prisma модели (`RiskRule`, `RiskResult`, sessions, и т.п.)

- `shopify.app.toml`  
  Конфиг Shopify app, webhooks и scopes.

---

## Модель данных (MVP)

### RiskRule
Хранит правила скоринга для магазина.

Поля:
- `type`: `ORDER_VALUE | FIRST_TIME | HIGH_QTY | COUNTRY_MISMATCH`
- `operator`: `> | >= | = | != | < | <=`
- `value`: строка (`"300"`, `"true"`, `"DE"`)
- `points`: int
- `action`: `REVIEW | HOLD | TAG:xxx` (или null)
- `enabled`: boolean

### RiskResult
Результат вычисления риска по заказу.

Основные:
- `shop`, `orderGid`, `orderName`
- `score`, `riskLevel`, `reasonsJson`

Trust/idempotency:
- `payloadHash` (SHA1 stable fields)
- `lastTopic`, `lastEventAt`, `eventCount`
- `lastDecision`: `APPLIED | SKIPPED`
- `skipReason`: `UNCHANGED | ...`
- (опц.) `lastRiskChangeAt`

---

## Webhooks: как обрабатываем

Поддерживаем topics:
- `orders/create`
- `orders/updated`
- `orders/paid` (если включено)
- `app/uninstalled`

Пайплайн (упрощённо):
1) `authenticate.webhook(request)` → `{ topic, shop, payload, admin }`
2) normalize topic
3) stable fields → `payloadHash`
4) `computeRiskFromWebhookPayload(shop, payload, topic)`
5) `upsertRiskIfChanged(...)`:
   - если unchanged → записать trust-поля + decision=SKIPPED + skipReason=UNCHANGED
   - если changed → update risk + trust-поля + decision=APPLIED
6) если changed → Shopify side effects (tags + assessment)

---

## Мультиязычность (i18n)

- Язык определяется через query param `?lang=xx` (fallback на default).
- `SUPPORTED_LANGS` — список языков (EN/DE/FR/ES и т.д.)
- В UI все строки через `t(lang, "key")`.
- Принцип: новые тексты добавляем **сразу** в словари.

---

## Локальный запуск (dev)

Типовой сценарий (может отличаться от окружения):
1) Установить зависимости:
   - `npm install`
2) Prisma:
   - `npx prisma migrate dev`
3) Shopify dev:
   - `shopify app dev`

---

## Политика данных (важно для Shopify)

- В stable hash и UI **не тянем protected customer data** (email/phone/zip и т.д.) без необходимости.
- В risk reasons держим либо коды, либо безопасные детали (без PII).

---

## Что делает Shopify “с коробки” и где наше преимущество

Shopify показывает базовые fraud indicators/insights (типа CVV unavailable, IP info и т.п.).
RiskMate отличается:
- **ваши правила и ваши веса** (вместо “черного ящика”)
- **автоматические сайд-эффекты** (теги/ассессмент/поток обработки)
- **идемпотентность** + журналирование “почему SKIPPED”
- **настраиваемый риск-скоринг** под конкретный бизнес

---

## Roadmap (следующие шаги)

### E1 (сделано/в процессе)
- i18n словари и перенос UI строк в `strings.ts`.

### E2 (в работе сейчас)
- Tab Events: показывать последние события отдельно от Orders.
  - В Events должна быть ссылка на заказ (Admin URL).
  - В Orders убрать “Recent events” блок (или оставить мини trust-строки только в rows).

### E3 (следом)
- “Event log” полноценно:
  - модель `RiskEvent` (если ещё не добавлена/не стабилизирована),
  - запись события на каждый webhook: `{topic, eventAt, payloadHash, decision, skipReason, riskLevelAfter, scoreAfter}`
  - Events tab использует **RiskEvent**, а не `RiskResult`.

### E4
- Улучшить “why skipped” причины:
  - `DUPLICATE_EVENT`, `NO_RULES`, `IGNORED_TOPIC`, `HASH_UNCHANGED`, `ERROR_HANDLED`, etc.

### E5 (позже, но держим в плане)
- Production hardening:
  - rate limiting / защита webhook routes
  - retries safety (Shopify expects 200)
  - better logging (без PII)
  - optional: экспорт/импорт rules
  - optional: presets для ниш (clothing, electronics…)

---

## Принципы разработки (важно)

- “Deterministic first”: предсказуемость > магия.
- “No protected data by default”.
- Любое событие webhook должно оставлять след:
  - **когда** пришло
  - **что** было решено
  - **почему** (decision + skipReason)

---

## Notes для будущих сессий ChatGPT

Если ты (Stanislav) кидаешь мне ссылку на репо и этот README — я должен:
1) Прочитать “Что уже сделано” и “Roadmap”
2) Спросить только если реально не хватает данных
3) Давать патчи строго под текущие файлы/пути и стиль проекта
