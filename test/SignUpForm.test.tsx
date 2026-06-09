// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SignUpForm from "@/components/auth/SignUpForm";

function getForm(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector("form");
  if (!form) throw new Error("form not found");
  return form;
}

// Component-layer coverage of the signup form's richer validation. SignUpForm
// has no redirect field (signup always lands on /auth/confirm-email), so none
// is asserted. Boundary is the native POST (§7).

describe("SignUpForm (R4 — component)", () => {
  it("shows required errors and blocks submit when fields are empty", () => {
    const { container } = render(<SignUpForm />);
    const form = getForm(container);

    expect(fireEvent.submit(form)).toBe(false);
    expect(screen.getByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.getByText("Please confirm your password")).toBeInTheDocument();
  });

  it("rejects a password shorter than the minimum length", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignUpForm />);
    const form = getForm(container);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/^password$/i), "abc");
    await user.type(screen.getByLabelText(/confirm password/i), "abc");

    expect(fireEvent.submit(form)).toBe(false);
    expect(screen.getByText("Password must be at least 6 characters")).toBeInTheDocument();
  });

  it("shows the remaining-characters hint while a short password is typed", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/^password$/i), "abc");

    expect(screen.getByText("3 more characters needed")).toBeInTheDocument();
  });

  it("rejects mismatched password confirmation", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignUpForm />);
    const form = getForm(container);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/^password$/i), "secret6");
    await user.type(screen.getByLabelText(/confirm password/i), "secret7");

    expect(fireEvent.submit(form)).toBe(false);
    expect(screen.getByText("Passwords do not match")).toBeInTheDocument();
  });

  it("renders the server error returned from the bounced redirect", () => {
    render(<SignUpForm serverError="User already registered" />);
    expect(screen.getByText("User already registered")).toBeInTheDocument();
  });
});
