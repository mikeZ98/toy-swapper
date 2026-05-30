import type { Counterparty } from "@/types";

/**
 * Golden snapshot of the seeded counterparty pool, byte-identical to the rows in
 * `supabase/migrations/20260530120000_counterparties.sql` (and, until Phase 3,
 * to `src/lib/fixture-pool.ts`). Lets the determinism suite run pure — no DB —
 * in CI. The pgTAP test (`supabase/tests/counterparties.test.sql`) ties the DB
 * rows to this same data; the Phase-2 equivalence assertion ties this to the
 * v1 FIXTURE_POOL before that module is deleted.
 */
export const GOLDEN_POOL: Counterparty[] = [
  {
    id: "kasia-warszawa",
    name: "Kasia (Warszawa)",
    give: "klocki LEGO Duplo bardzo dobry stan; książka 'Mała Mi' twarda oprawa; bluza H&M rozmiar 92 jak nowa",
    want: "autko resorak; plastikowe kubki do piasku; czapka zimowa rozmiar 92",
  },
  {
    id: "tom-krakow",
    name: "Tom (Kraków)",
    give: "Toy car Hot Wheels x3 like new; LEGO Classic 200 pieces good condition; Winter hat size 92 used",
    want: "LEGO Duplo any set; kids book Polish or English; hoodie size 92",
  },
  {
    id: "ania-wroclaw",
    name: "Ania (Wrocław)",
    give: "lalka Barbie z domkiem dobry stan; puzzle 100 elementów Disney nowe; zestaw kredek 24 szt jak nowy",
    want: "klocki LEGO Duplo; plastikowa zjeżdżalnia; książki dla dzieci",
  },
  {
    id: "piotr-gdansk",
    name: "Piotr (Gdańsk)",
    give: "rowerek biegowy Puky używany dobry stan; kombinezon zimowy Reima rozmiar 98; gumowce żabki rozmiar 24",
    want: "wózek spacerowy; fotelik samochodowy 9-18kg",
  },
  {
    id: "mira-poznan",
    name: "Mira (Poznań)",
    give: "Plastic sandcastle bucket set new; H&M hoodie size 92 like new; children book set 5 books used",
    want: "LEGO Duplo; art supplies; Barbie doll",
  },
];
