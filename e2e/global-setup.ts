import { ensureTestUser } from "./support";

// Runs once before any project. Seeding here (rather than in each spec/project)
// avoids concurrent same-email signUp races — two parallel inserts surface as
// GoTrue's generic "Database error saving new user" rather than "already
// registered". Single sequential seed sidesteps that entirely.
export default async function globalSetup(): Promise<void> {
  await ensureTestUser();
}
