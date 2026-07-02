# Raport Analizy MVP — ToySwapper

> Analiza wykonana zgodnie z frameworkiem `mvp-check.md` (10xDevs / blok 10xBuilder).
> Ocena wyłącznie na podstawie kodu i dokumentacji w repozytorium. Poza zakresem
> (nieoceniane): warstwa wizualna, style, dostępność, hosting/deployment.
>
> Data analizy: 2026-07-02. Testy uruchomione na żywo na lokalnym stosie Supabase.

**Typ projektu (wywnioskowany z plików):** aplikacja webowa Astro 6 SSR + React 19 na
Cloudflare Workers, z Supabase (auth + Postgres z RLS). Domena: zamiana zabawek między
rodzicami — dwie listy „daję/chcę" → kontrakt barterowy w Markdown z werdyktem
sprawiedliwości szacowanym przez LLM.

## ✅ Checklista kryteriów

### 1. Operacje CRUD — ✅ SPEŁNIONE

Wszystkie cztery operacje istnieją dla trwałych encji (Postgres przez klienta SSR
Supabase), nie tylko w UI:

| Operacja   | Dowód                                                                                                                                                                                                                                                                                           | Encja                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Create** | `saveEvaluation()` — `insert` do `evaluation_history` (`src/lib/evaluation-history.ts:33`); `saveUserLists()` — `upsert` (`src/lib/user-lists.ts:17`)                                                                                                                                           | historia ocen / listy |
| **Read**   | `getEvaluationHistory()` — `select ... order created_at desc` (`src/lib/evaluation-history.ts:83`); `getUserLists()` (`src/lib/user-lists.ts:44`)                                                                                                                                               | jw.                   |
| **Update** | `saveUserLists()` — `upsert(..., { onConflict: "user_id" })` nadpisuje istniejący wiersz per użytkownik (`src/lib/user-lists.ts:29`); tabela ma `UNIQUE(user_id)`                                                                                                                               | listy give-want       |
| **Delete** | `deleteEvaluation()` — `delete().eq("id").eq("user_id")` (`src/lib/evaluation-history.ts:65`), wywoływane przez endpoint `POST /api/history/delete` (`src/pages/api/history/delete.ts:16`), a ten przez **form POST** w `src/pages/history.astro:82-94` (progresywne ulepszanie, bez JS island) | historia ocen         |

Ścieżka `deleteEvaluation` jest domknięta end-to-end (formularz → endpoint → serwis →
RLS), z obroną w głąb (`user_id` jawnie w filtrze mimo RLS) oraz wzorcem POST/redirect/GET
(303 → `/history`).

### 2. Logika biznesowa — ✅ SPEŁNIONE

Rdzeniem jest silnik `src/lib/evaluator.ts` — potok daleko wykraczający poza CRUD:
**standaryzacja → wycena → dopasowanie → werdykt sprawiedliwości → render Markdown**.

- **Wycena** (`classifyItemStub`, `evaluator.ts:66`) — mapowanie słów kluczowych PL/EN na
  kategorie + ceny bazowe PLN × mnożnik stanu × ilość.
- **Dopasowanie dwukierunkowe** (`findBestMatch`, `evaluator.ts:215`) — kontrahent pasuje
  tylko gdy daje coś, czego operator chce **i** chce czegoś, co operator daje
  (`receiving === 0 || giving === 0 → continue`); wybór: najlepszy delta, potem najwięcej
  dopasowań.
- **Werdykt względny** (`computeVerdict`, `evaluator.ts:254`) — `FAIR` gdy
  `delta / max(A,B) ≤ próg%`, inaczej `NEEDS BALANCING` (próg konfigurowalny, FR-009).
- **Sugestia równoważenia** (`balancingSuggestion`, `evaluator.ts:261`) — dobiera przedmiot
  do usunięcia, by zejść poniżej progu.
- **Determinizm** — LLM przy `temperature: 0`, `seed: 42`, z cache na wejściu i
  deterministycznym fallbackiem stub gdy brak `OPENAI_API_KEY` (`processList`,
  `evaluator.ts:171`).

### 3. Testy adresujące zdefiniowane ryzyko — ✅ SPEŁNIONE

Istnieje plan testów `context/foundation/test-plan.md` z mapą ryzyk (§2), a testy mapują
się na konkretne ryzyka. **Wyniki uruchomione na żywo:** Vitest **126/126 ✅** (18 plików),
pgTAP **40/40 ✅** (5 plików).

| Ryzyko (z planu)                                                  | Test pokrywający                                                                                                                            | Wynik       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **R1** — zalogowany użytkownik czyta cudzą historię (wyciek)      | `supabase/tests/evaluation-history.test.sql`, `evaluation-history-delete.test.sql` — izolacja SELECT/INSERT/DELETE per użytkownik           | ok          |
| **R2** — test RLS zielony mimo złej polityki (fałszywa siatka)    | `evaluation-history-delete.test.sql:99` — **kontrola negatywna**: rozluźnia SELECT do `using(true)`, dowodzi że bramką jest polityka DELETE | ok          |
| **R3** — regresja bramki auth (brak 401/redirect)                 | `test/middleware.test.ts` — anon page → redirect z zachowaniem celu, anon API → `401 JSON`, sub-ścieżki gated                               | 7 testów ok |
| **R5** — trwały kontrakt renderowany ponownie zamiast bajt-w-bajt | `test/determinism.test.ts` — porównanie z „golden snapshot"                                                                                 | ok          |

### 4. Uwierzytelnianie powiązane z użytkownikiem — ✅ SPEŁNIONE

Dwuwarstwowa ochrona:

- **Bramka sesji** — `src/middleware.ts:16` rozwiązuje użytkownika na
  `context.locals.user` przy każdym żądaniu; `isGated()` chroni `/`, `/dashboard`,
  `/history`, `/api/evaluate`, `/api/history`. Strony → redirect do `/auth/signin` z
  zachowanym celem; `/api/*` → `401 JSON`.
- **Zakresowanie zasobów per użytkownik (RLS)** —
  `supabase/migrations/20260609113408_evaluation_history.sql:52-68`: polityki per-operacja,
  per-rola (`select/insert/delete to authenticated using (user_id = app.current_user_id())`),
  brak `update` (log append-only). Spełnia kontrakt „to jest twój wiersz", nie tylko „jesteś
  zalogowany" (ochrona przed IDOR).

### 5. Dokumentacja — ✅ SPEŁNIONE

Fundament 10x żyje w `context/foundation/` (sprawdzany w pierwszej kolejności) i zawiera
realną treść, nie placeholdery:

- **PRD** — `context/foundation/prd.md` (223 linie): problem, zakres, US-01…US-05,
  FR-004/008/009/015/016/018/019, NFR, Non-Goals.
- **Roadmap** — `context/foundation/roadmap.md` (pionowe slice'y S-01…S-03).
- **Test-plan** — `context/foundation/test-plan.md` (mapa ryzyk, fazy, bramki jakości).
- Dodatkowo: `conventions.md`, `tech-stack.md`, `shape-notes.md`, `infrastructure.md`,
  `lessons.md`, `README.md` + zagnieżdżone `CLAUDE.md` per katalog.

## 📊 Status Projektu

| #   | Kryterium        | Wynik |
| --- | ---------------- | :---: |
| 1   | CRUD             |  ✅   |
| 2   | Logika biznesowa |  ✅   |
| 3   | Testy vs. ryzyko |  ✅   |
| 4   | Uwierzytelnianie |  ✅   |
| 5   | Dokumentacja     |  ✅   |

### Wynik: 5/5 = 100% — próg techniczny MVP w pełni zaliczony ✅

## 🎯 Priorytetowe usprawnienia

Wszystkie kryteria minimalne spełnione — brak obowiązkowych braków.

- **README zaktualizowane** (2026-07-02): wcześniejszy nagłówek boilerplate startera
  („10x Astro Starter") zastąpiono opisem ToySwappera; poprawiono też strukturę projektu,
  komendę clone oraz nieaktualne odniesienie do `PROTECTED_ROUTES` (faktyczny helper to
  `isGated()`).

## 🌟 Ponad minimum

Projekt wyraźnie wykracza poza próg minimalny:

- **Twarda gwarancja determinizmu** (seed + cache + fallback stub, testy „golden
  snapshot") — bajt-identyczne kontrakty na re-run.
- **Kontrole negatywne w testach RLS** (R2) — dowodzą, że bramką jest właśnie polityka
  DELETE, a nie widoczność SELECT: dojrzała obrona przed „fałszywą zielenią".
- **Logowanie strukturalne** z korelacją `request_id`, zasada „nigdy nie loguj surowego
  wejścia/wyjścia użytkownika".
- **Wejścia dwujęzyczne PL+EN**, wyjście CommonMark, budżet ≤ 5 s.

Kwalifikuje to projekt jako kandydata do wyróżnienia / zaproszenia na Demo Day.
