// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusPill } from "@/components/status-pill";

afterEach(cleanup);

describe("StatusPill", () => {
  it("renderiza o conteúdo textual", () => {
    render(<StatusPill tone="success">Enviada</StatusPill>);
    expect(screen.getByText("Enviada")).toBeInTheDocument();
  });

  it.each([
    ["success", "bg-success-bg"],
    ["warning", "bg-warning-bg"],
    ["danger", "bg-danger-bg"],
    ["info", "bg-info-bg"],
    ["neutral", "bg-neutral-bg"],
    ["purple", "bg-purple-bg"],
  ] as const)("tom %s aplica o par de cores correspondente", (tone, cls) => {
    const { container } = render(<StatusPill tone={tone}>x</StatusPill>);
    expect(container.querySelector(`.${cls}`)).not.toBeNull();
  });
});
