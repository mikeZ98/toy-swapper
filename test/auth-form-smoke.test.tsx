// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import SignInForm from "@/components/auth/SignInForm";

// Toolchain smoke test: proves jsdom + @testing-library/react + jest-dom + the
// .tsx include path all resolve before the real form specs (Phase 3) land.
describe("component test toolchain", () => {
  it("renders a React form component under jsdom", () => {
    render(<SignInForm />);
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
