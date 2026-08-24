// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WeekSelector, type WeekOption } from "@/components/week-selector";

afterEach(cleanup);

const weeks: WeekOption[] = [
  { id: "w1", weekKey: "Semana 33", startDate: "16 de ago.", endDate: "22 de ago." },
  { id: "w2", weekKey: "Semana 34", startDate: "23 de ago.", endDate: "29 de ago." },
];

describe("WeekSelector", () => {
  it("lista as semanas e marca o valor atual", () => {
    render(<WeekSelector weeks={weeks} value="w1" onChange={() => {}} />);
    const select = screen.getByLabelText("Semana") as HTMLSelectElement;
    expect(select.value).toBe("w1");
    expect(screen.getByText(/Semana 33/)).toBeInTheDocument();
    expect(screen.getByText(/Semana 34/)).toBeInTheDocument();
  });

  it("dispara onChange com o id da semana escolhida", () => {
    const onChange = vi.fn();
    render(<WeekSelector weeks={weeks} value="w1" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Semana"), {
      target: { value: "w2" },
    });
    expect(onChange).toHaveBeenCalledWith("w2");
  });

  it("renders status when provided", () => {
    const weeksWithStatus: WeekOption[] = [
      { id: "w1", weekKey: "Semana 33", startDate: "16 de ago.", endDate: "22 de ago.", status: "PLANNING" },
    ];
    render(<WeekSelector weeks={weeksWithStatus} value="w1" onChange={() => {}} />);
    expect(screen.getByText(/PLANNING/)).toBeInTheDocument();
  });

  it("estado vazio mostra mensagem em vez do select", () => {
    render(<WeekSelector weeks={[]} value="" onChange={() => {}} />);
    expect(screen.getByText("Nenhuma semana cadastrada")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("respeita disabled", () => {
    render(
      <WeekSelector weeks={weeks} value="w1" onChange={() => {}} disabled />,
    );
    expect(screen.getByLabelText("Semana")).toBeDisabled();
  });
});
