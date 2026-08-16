// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { BehaviorClient } from "../client";

const { mockListInfractions } = vi.hoisted(() => ({
  mockListInfractions: vi.fn(),
}));

vi.mock("../actions", () => ({
  listInfractions: mockListInfractions,
  markInfraction: vi.fn(),
  approveInfraction: vi.fn(),
  rejectInfraction: vi.fn(),
  escalateRecidivism: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

const INFRACTION = {
  id: "i1",
  type: "LATE_DELIVERY",
  typeLabel: "Atraso na rota",
  punishment: "perde 1 vaga",
  observation: null,
  weekKey: "WK-32",
  effectiveWeekKey: "WK-33",
  status: "ACTIVE",
  multiplier: 1,
  driverName: "Carlos Eduardo Lima",
  driverUserId: "u1",
  markedByName: "Marcos Souza",
  approvedByName: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  fulfilledAt: null,
  supervisorNotifiedAt: null,
  escalatedAt: null,
  escalationDue: false,
} as const;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("BehaviorClient", () => {
  it("loading: enquanto listInfractions não responde, mostra skeleton e NUNCA o estado vazio", async () => {
    const d = deferred<never>();
    mockListInfractions.mockReturnValue(d.promise);

    render(<BehaviorClient drivers={[]} weeks={[]} infractionTypes={[]} />);

    // A asserção central do P4: durante a carga, o "vazio" não pode aparecer.
    expect(
      screen.queryByText("Nenhuma infração registrada"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("datatable-skeleton-row").length,
    ).toBeGreaterThan(0);
  });

  it("vazio: após carregar sem infrações, mostra o EmptyState (sem skeleton)", async () => {
    mockListInfractions.mockResolvedValue({
      success: true,
      data: {
        infractions: [],
        approvalQueue: [],
        pending: [],
        recidivismWarnings: [],
        canApprove: false,
      },
    });

    render(<BehaviorClient drivers={[]} weeks={[]} infractionTypes={[]} />);

    await waitFor(() =>
      expect(screen.getByText("Nenhuma infração registrada")).toBeInTheDocument(),
    );
    expect(screen.queryAllByTestId("datatable-skeleton-row")).toHaveLength(0);
  });

  it("com dados: renderiza linha com StatusPill e sem estado vazio", async () => {
    mockListInfractions.mockResolvedValue({
      success: true,
      data: {
        infractions: [INFRACTION],
        approvalQueue: [],
        pending: [],
        recidivismWarnings: [],
        canApprove: false,
      },
    });

    render(<BehaviorClient drivers={[]} weeks={[]} infractionTypes={[]} />);

    await waitFor(() =>
      expect(screen.getByText("Carlos Eduardo Lima")).toBeInTheDocument(),
    );
    expect(screen.getByText("Em cumprimento")).toBeInTheDocument();
    expect(screen.getByText("WK-33")).toBeInTheDocument();
    expect(
      screen.queryByText("Nenhuma infração registrada"),
    ).not.toBeInTheDocument();
  });
});
