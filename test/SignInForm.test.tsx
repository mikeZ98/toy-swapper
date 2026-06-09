// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SignInForm from "@/components/auth/SignInForm";

function getForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector("form");
  if (!form) throw new Error("form not found");
  return form;
}

// These are native method="POST" forms (no fetch), so the boundary is the POST
// itself — the component tests assert *our* wiring only: client validation,
// submit gating, inline + server error display, and the hidden redirect field
// (§7). The valid-submit → redirect path lives in the endpoint integration test.

describe("SignInForm (R4 — component)", () => {
  it("shows required errors and blocks submit when fields are empty", () => {
    const { container } = render(<SignInForm />);
    const form = getForm(container);

    // fireEvent.submit returns false when a handler called preventDefault.
    const notPrevented = fireEvent.submit(form);

    expect(notPrevented).toBe(false);
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
  });

  it("rejects an invalid email format", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignInForm />);
    const form = getForm(container);

    await user.type(screen.getByLabelText(/email/i), "notanemail");
    await user.type(screen.getByLabelText(/^password$/i), "secret");

    expect(fireEvent.submit(form)).toBe(false);
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("clears a field error once the user edits that field", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignInForm />);
    const form = getForm(container);

    fireEvent.submit(form);
    expect(screen.getByText("Email is required")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    expect(screen.queryByText("Email is required")).not.toBeInTheDocument();
  });

  it("allows submit when inputs are valid (no preventDefault, no errors)", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignInForm />);
    const form = getForm(container);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret");

    // Valid → handler does not preventDefault → native submit proceeds.
    expect(fireEvent.submit(form)).toBe(true);
    expect(screen.queryByText(/required|valid email/i)).not.toBeInTheDocument();
  });

  it("renders the server error returned from the bounced redirect", () => {
    render(<SignInForm serverError="Invalid login credentials" />);
    expect(screen.getByText("Invalid login credentials")).toBeInTheDocument();
  });

  it("carries the redirect target in the hidden field, defaulting to /", () => {
    const { container, rerender } = render(<SignInForm redirect="/dashboard?tab=history" />);
    expect(container.querySelector('input[name="redirect"]')).toHaveValue("/dashboard?tab=history");

    rerender(<SignInForm />);
    expect(container.querySelector('input[name="redirect"]')).toHaveValue("/");
  });
});
