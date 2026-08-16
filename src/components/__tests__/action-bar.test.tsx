// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ActionBar } from "@/components/action-bar";

afterEach(cleanup);

describe("ActionBar", () => {
  it("renderiza as ações filhas", () => {
    render(
      <ActionBar>
        <button>Distribuir vagas</button>
        <button>Nova Vaga</button>
      </ActionBar>,
    );
    expect(
      screen.getByRole("button", { name: "Distribuir vagas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nova Vaga" }),
    ).toBeInTheDocument();
  });
});
