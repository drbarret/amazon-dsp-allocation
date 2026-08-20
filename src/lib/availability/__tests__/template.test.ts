import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { downloadAvailabilityTemplate } from "@/lib/availability/template";

vi.mock("server-only", () => ({}));

describe("downloadAvailabilityTemplate", () => {
  it("generates an .xlsx with the expected header row", () => {
    const { buffer, filename } = downloadAvailabilityTemplate();

    expect(filename).toBe("DA_Disponibilidade_modelo.xlsx");
    expect(buffer.byteLength).toBeGreaterThan(0);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(worksheet).toBeDefined();

    const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
    });
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual([
      "Carimbo de data/hora",
      "Endereço de e-mail",
      "Nome completo",
      "CPF",
      "GNV?",
      "Passeio?",
      "Dom",
      "Seg",
      "Ter",
      "Qua",
      "Qui",
      "Sex",
      "Sáb",
      "Speed?",
    ]);
  });
});
