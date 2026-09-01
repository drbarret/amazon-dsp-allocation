import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parsePerformanceCsv,
  parsePerformanceXlsx,
} from "@/lib/performance/csv-parser";

function encodeCsv(
  text: string,
  encoding: "utf-8" | "iso-8859-1",
): ArrayBuffer {
  const encoder = new TextEncoder();
  if (encoding === "utf-8") {
    return encoder.encode(text).buffer;
  }
  // Latin-1: each char becomes one byte.
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes.buffer;
}

const SAMPLE_CSV = `Nome;Transporter ID;Score;Pacotes Entregues;DCR;Insucessos;DNR DPMO;Contact Compliance;Swipe to Finish Compliance;100% WHC
Marcelo Camargo;A3P2DUI47V0SU0;Fantastic;725;99%;7.25;0;100%;95%;Yes
Mara Alves Braz;A290ACFF14HMPO;Great;605;98%;12.1;1;0.95;0.90;No
Renato Jose Miranda;RMZNFKEDMRPWE;Fair;514;0.93;35.98;0;1;1;1`;

describe("parsePerformanceCsv", () => {
  it("parses the sample CSV with semicolon separator and new columns", () => {
    const result = parsePerformanceCsv(encodeCsv(SAMPLE_CSV, "utf-8"));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);

    const first = result.rows[0];
    expect(first.name).toBe("Marcelo Camargo");
    expect(first.transporterId).toBe("A3P2DUI47V0SU0");
    expect(first.scoreText).toBe("Fantastic");
    expect(first.classification).toBe("FANTASTIC");
    expect(first.deliveredPackages).toBe(725);
    expect(first.dcr).toBe(0.99);
    expect(first.insucessos).toBe(7);
    expect(first.dnr).toBe(0);
    expect(first.contactCompliance).toBe(1);
    expect(first.swipeToFinishCompliance).toBe(0.95);
    expect(first.whc100).toBe(true);

    const second = result.rows[1];
    expect(second.scoreText).toBe("Great");
    expect(second.classification).toBe("GREAT");
    expect(second.whc100).toBe(false);

    const third = result.rows[2];
    expect(third.scoreText).toBe("Fair");
    expect(third.classification).toBe("FAIR");
  });

  it("falls back to Latin-1 when UTF-8 decoding fails", () => {
    const nameWithAccent = "Lu\xedz Fernando"; // Latin-1 encoded "Lu\xedz"
    const csv = `Nome;Transporter ID;Score;Pacotes Entregues;DCR;Insucessos;DNR DPMO;Contact Compliance;Swipe to Finish Compliance;100% WHC
${nameWithAccent};A1NVG23ZLR1L69;Fantastic Plus;383;98%;7.66;0;100%;100%;Yes`;

    const result = parsePerformanceCsv(encodeCsv(csv, "iso-8859-1"));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Lu\xedz Fernando");
    expect(result.rows[0].classification).toBe("FANTASTIC_PLUS");
  });

  it("handles DCR, Contact and Swipe as raw decimal, integer or percentage", () => {
    const csv = `Nome;Transporter ID;Score;Pacotes Entregues;DCR;Insucessos;DNR DPMO;Contact Compliance;Swipe to Finish Compliance;100% WHC
A;T1;Fantastic;100;0.99;1;0;0.99;0.99;Yes
B;T2;Fantastic;100;99;1;0;99;99;Yes
C;T3;Fantastic;100;99%;1;0;99%;99%;Yes`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.dcr, r.contactCompliance, r.swipeToFinishCompliance])).toEqual([
      [0.99, 0.99, 0.99],
      [0.99, 0.99, 0.99],
      [0.99, 0.99, 0.99],
    ]);
  });

  it("returns errors for invalid rows", () => {
    const csv = `Nome;Transporter ID;Score;Pacotes Entregues;DCR;Insucessos;DNR DPMO;Contact Compliance;Swipe to Finish Compliance;100% WHC
A;;Fantastic;100;99%;1;0;100%;100%;Yes
A;T1;Invalid;100;99%;1;0;100%;100%;Yes
A;T1;Fantastic;-1;99%;1;0;100%;100%;Yes
A;T1;Fantastic;100;150%;1;0;100%;100%;Yes
A;T1;Fantastic;100;99%;1;x;100%;100%;Yes
A;T1;Fantastic;100;99%;1;0;150%;100%;Yes
A;T1;Fantastic;100;99%;1;0;100%;100%;Maybe`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(7);
  });

  it("allows missing Nome column and returns null name", () => {
    const csv = `Transporter ID;Score;Pacotes Entregues;DCR;Insucessos;DNR DPMO;Contact Compliance;Swipe to Finish Compliance;100% WHC
T1;Fantastic;100;99%;1;0;100%;100%;Yes`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBeNull();
    expect(result.rows[0].transporterId).toBe("T1");
  });

  it("maps textual scores to classifications correctly", () => {
    const csv = `Nome;Transporter ID;Score;Pacotes Entregues;DCR;Insucessos;DNR DPMO;Contact Compliance;Swipe to Finish Compliance;100% WHC
A;T1;Poor;100;99%;1;0;100%;100%;Yes
B;T2;Fair;100;99%;1;0;100%;100%;Yes
C;T3;Great;100;99%;1;0;100%;100%;Yes
D;T4;Fantastic;100;99%;1;0;100%;100%;Yes
E;T5;Fantastic Plus;100;99%;1;0;100%;100%;Yes
F;T6;F+;100;99%;1;0;100%;100%;Yes
G;T7;Ruim;100;99%;1;0;100%;100%;Yes
H;T8;Bom;100;99%;1;0;100%;100%;Yes
I;T9;Razo\xe1vel;100;99%;1;0;100%;100%;Yes`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.classification)).toEqual([
      "POOR",
      "FAIR",
      "GREAT",
      "FANTASTIC",
      "FANTASTIC_PLUS",
      "FANTASTIC_PLUS",
      "POOR",
      "GREAT",
      "FAIR",
    ]);
  });
});

describe("parsePerformanceXlsx", () => {
  it("parses a valid performance XLSX", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        "Nome",
        "Transporter ID",
        "Score",
        "Pacotes Entregues",
        "DCR",
        "Insucessos",
        "DNR DPMO",
        "Contact Compliance",
        "Swipe to Finish Compliance",
        "100% WHC",
      ],
      [
        "Daniel Santos de Andrade",
        "A2HCJBM9Q0LXSF",
        "Fantastic",
        1016,
        0.9807,
        19.6088,
        0,
        1,
        0,
        true,
      ],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planilha1");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const result = parsePerformanceXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(0);

    const first = result.rows[0];
    expect(first.name).toBe("Daniel Santos de Andrade");
    expect(first.transporterId).toBe("A2HCJBM9Q0LXSF");
    expect(first.scoreText).toBe("Fantastic");
    expect(first.classification).toBe("FANTASTIC");
    expect(first.deliveredPackages).toBe(1016);
    expect(first.dcr).toBe(0.9807);
    expect(first.insucessos).toBe(20);
    expect(first.dnr).toBe(0);
    expect(first.contactCompliance).toBe(1);
    expect(first.swipeToFinishCompliance).toBe(0);
    expect(first.whc100).toBe(true);
  });

  it("parses XLSX without Nome column", () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        "Transporter ID",
        "Score",
        "Pacotes Entregues",
        "DCR",
        "Insucessos",
        "DNR DPMO",
        "Contact Compliance",
        "Swipe to Finish Compliance",
        "100% WHC",
      ],
      ["A2HCJBM9Q0LXSF", "Fantastic", 1016, 0.9807, 19.6088, 0, 1, 0, true],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Planilha1");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const result = parsePerformanceXlsx(buffer);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBeNull();
    expect(result.rows[0].transporterId).toBe("A2HCJBM9Q0LXSF");
  });
});
