# Raport Analizy Zaawansowanej — ToySwapper

## Ścieżki 10xArchitect (Moduł 4) & 10xChampion (Moduł 5)

> Analiza wg frameworku `mvp-check-2.md`. Poza zakresem: warstwa wizualna, UI,
> deployment. Ocena wyłącznie na podstawie architektury kodu, workflow automatyzacji
> i dokumentacji inżynierskiej w repozytorium.
>
> Data analizy: 2026-07-02.

## ✅ Checklista — 10xArchitect (Moduł 4)

| Komponent (Proof-of-Work)                     | Status | Dowód                                                                                                                                                                                                     |
| --------------------------------------------- | :----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Raport Architektoniczny** (two-pager, M4L5) |   ✅   | `context/architect-report.md` — synteza L2–L5 z sekcją „Decisions that belong to me"; skala: 36 plików, 55 krawędzi importu, **0 cykli, 0 naruszeń warstw**                                               |
| **L2 — Repository Map**                       |   ✅   | `context/map/repo-map.md` (12 KB) — warstwy pages/API → `src/lib` → `types.ts`, keystones (`supabase.ts` fan-in 7), 6 stref ryzyka (Z1–Z6)                                                                |
| **L3 — Feature Research**                     |   ✅   | `context/archive/2026-06-11-evaluate-flow-analysis/research.md`, `2026-06-09-feature-evaluation-history/research.md` — śledzenie `POST /api/evaluate` end-to-end                                          |
| **L4 — Refactoring Plan**                     |   ✅   | `context/archive/2026-06-17-refactor-opportunities/research.md` — 3 uszeregowane refaktory z archetypami; weryfikacja ast-grep 0.43.0 ⇄ grep ⇄ git; + `context/domain/02-invariant-aggregate-refactor.md` |
| **L5 — Domain Notes (DDD)**                   |   ✅   | `context/domain/` — `01-domain-distillation.md`, `02-invariant-aggregate-refactor.md` (agregat `ListValuation`), `03-anti-corruption-layer.md` (porty/adaptery)                                           |

### Wynik ścieżki Architect: 5/5 = 100% ✅

## ✅ Checklista — 10xChampion (Moduł 5)

Wymagany **co najmniej jeden** z dwóch przepływów. Zaimplementowana i kompletna jest **Opcja A**.

| Kryterium                                                   | Status | Dowód                                                                                                                                                                                                |
| ----------------------------------------------------------- | :----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opcja A — Pipeline automatycznego code review (M5L2–L3)** |   ✅   | patrz niżej                                                                                                                                                                                          |
| ├─ Workflow z zadaniem review                               |   ✅   | `.github/workflows/git-brief-review.yml` — job `ai-review` na `pull_request`                                                                                                                         |
| ├─ Wywołanie silnika AI / skryptu                           |   ✅   | `npm run git-brief` → `scripts/git-brief/` (13 modułów TS: `extract`, `downsample`, `synthesis` przez OpenRouter LLM, `cache`, `stub`, `template`)                                                   |
| └─ Sticky comment z powrotem na PR                          |   ✅   | `git-brief-review.yml:54` — `gh pr comment --edit-last --create-if-none` (aktualizacja komentarza w miejscu)                                                                                         |
| **Opcja B — Rejestr artefaktów zespołu (M5L4)**             |   ⏩   | Nie jest wybranym przepływem — specyfikacje M5L4 istnieją jako skille/prompty w `.claude/` (`setup-cicd`, `pack-init`, `tf-registry`), ale brak workflow pakującego/publikującego artefakt tego repo |

### Status ścieżki Champion: ZALICZONY ✅ — poprzez kompletną Opcję A (3/3 podkryteria)

## ⚠️ Sprostowanie do założeń audytu (weryfikacja, nie założenie)

Pierwotne polecenie sugerowało szukać automatyzacji review „zintegrowanej w pliku
`.github/workflows/ci.yml`". Na podstawie faktycznego kodu wymaga to korekty:

- **`ci.yml` NIE zawiera zadania AI code review** — ma jedynie job `ci` (lint + build +
  `npm test`) oraz job `db` (Postgres → `db lint` → `supabase test db` → warunkowy
  `db push`). Job `db` **jest obecny** (`ci.yml:28`), zgodnie z opisem.
- **Automatyzacja review żyje w OSOBNYM pliku** `.github/workflows/git-brief-review.yml`,
  nie w `ci.yml`. Ścieżka Champion i tak jest zaliczona — ale przez ten drugi workflow.
- **Guard graceful-degradation zweryfikowany dokładnie jak opisano** ✅:
  `env: SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}` na poziomie job
  (`ci.yml:33-34`) + `if: … && env.SUPABASE_PROJECT_REF != ''` (`ci.yml:56`). Krok
  `Push migrations to production` **pomija się czysto** (skip, nie red-fail), gdy sekrety
  deploymentu są nieobecne — pipeline `master` zostaje zielony. Uwaga: ten mechanizm
  należy do potoku **deployment/db**, a nie do potoku code-review — to odporność
  wdrożenia, nie samego review.

## 🏛️ Obrona architektoniczna i jakość kodu

- **Izolacja domeny (`context/domain/`) jest realna, nie pozorna.** Notatki DDD
  identyfikują trafne rozjazdy języka wszechobecnego: „Pricing Catalog bez nazwy i domu"
  (źródło duplikacji z L4/C2), „jeden pool, trzy nazwy" (fixture/counterparty/valuation),
  anonimowy Operator (`userId: string` w 4 miejscach). Zaprojektowano agregat-strażnik
  `ListValuation.fromSegments(...)` czyniący inwariant FR-004 („żadnych cichych gubień")
  prawdziwym **z konstrukcji**, z błędami domenowymi (`ItemConservationError`) i value
  objects (`Pln`, `CategorySlug`).
- **Anti-Corruption Layer z mierzalną bramką.** Blueprint portu `ListProcessor` +
  adapterów (`OpenAi/Stub/Fallback`) z bramką zero-leak:
  `grep -rnE 'from "(ai|@ai-sdk/openai)"' src/` poza allow-listą musi zwracać 0 (dziś: 2+3
  — świadomie zdiagnozowany dług, nie ukryty).
- **Dojrzałość dowodowa.** Każde twierdzenie strukturalne w L4 uruchomiono dwukrotnie
  (ast-grep semantycznie + grep tekstowo) i skonfrontowano z historią git — konwencja
  EVIDENCE / INFERENCE / UNKNOWN.
- **Odporność potoków (graceful degradation w DWÓCH miejscach).** (1) Prod-push pomija się
  czysto bez sekretów. (2) `git-brief` przy braku `OPENROUTER_API_KEY` **degraduje do
  deterministycznego stub-brief** zamiast twardo failować job (`git-brief-review.yml:30-36`,
  `scripts/git-brief/stub.ts`) — potok review nie blokuje PR przy braku klucza. Uprawnienia
  workflow zawężone (`contents: read`, `pull-requests: write`).

## 🎯 Lista działań usprawniających (przed deadline'em)

1. **(Kosmetyczne, opcjonalne) Ujednolicić opis w dokumentacji.** Jeśli w zgłoszeniu
   certyfikacyjnym opisujesz review jako „zintegrowane w ci.yml" — popraw na
   `git-brief-review.yml`, aby opis zgadzał się z kodem.
2. **(Opcjonalne wzmocnienie Champion) Rozważyć dopięcie Opcji B.** Specyfikacje M5L4 już
   są w `.claude/` — realny workflow pakująco-publikujący (`setup-cicd`/`pack-init`) dałby
   drugi przepływ. Nie jest wymagane (wystarczy jeden).
3. **(Dług już zdiagnozowany, nie brak) Domknąć bramkę zero-leak ACL.** L5 wskazuje, że
   `ai`/`@ai-sdk/openai` przeciekają do Core w 2 plikach, a `SupabaseClient` w 3. Wdrożenie
   portu `ListProcessor` przekułoby blueprint w kod.
4. **Braków blokujących: BRAK.** Wszystkie artefakty Proof-of-Work istnieją, są w
   poprawnych katalogach i mają realną treść (żadnych placeholderów).

## Podsumowanie

- **10xArchitect: 100% (5/5)** — komplet L2–L5 + zsyntetyzowany two-pager
  `context/architect-report.md`, wszystko z realną treścią i weryfikacją narzędziową.
- **10xChampion: ZALICZONY** — kompletna Opcja A (pipeline `git-brief-review.yml` z
  LLM-synthesis i sticky comment); Opcja B pominięta (⏩), co jest w pełni dopuszczalne.
- **Jedno sprostowanie faktograficzne:** automatyzacja review jest w
  `git-brief-review.yml`, nie w `ci.yml` — ścieżka i tak zaliczona.
