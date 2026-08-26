import { describe, it, expect } from "vitest";
import { parsePerformanceCsv } from "@/lib/performance/csv-parser";

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

describe("parsePerformanceCsv", () => {
  it("parses the sample CSV with semicolon separator", () => {
    const csv = `Nome;TransporterID;Score;PacotesEntregues;DCR;DNR;Desempenho
Marcelo Camargo;A3P2DUI47V0SU0;100;725;99%;0;Fantastico Plus
Mara Alves Braz;A290ACFF14HMPO;85;605;98%;1;Bom
Renato Jose Miranda;RMZNFKEDMRPWE;72;514;93%;0;Razoavel`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);

    const first = result.rows[0];
    expect(first.name).toBe("Marcelo Camargo");
    expect(first.transporterId).toBe("A3P2DUI47V0SU0");
    expect(first.score).toBe(100);
    expect(first.deliveredPackages).toBe(725);
    expect(first.dcr).toBe(0.99);
    expect(first.dnr).toBe(0);
    expect(first.classification).toBe("FANTASTIC_PLUS");

    const second = result.rows[1];
    expect(second.score).toBe(85);
    expect(second.classification).toBe("GREAT");

    const third = result.rows[2];
    expect(third.score).toBe(72);
    expect(third.classification).toBe("GREAT");
  });

  it("falls back to Latin-1 when UTF-8 decoding fails", () => {
    const nameWithAccent = "Lu\xedz Fernando"; // Latin-1 encoded "Luíz"
    const csv = `Nome;TransporterID;Score;PacotesEntregues;DCR;DNR;Desempenho
${nameWithAccent};A1NVG23ZLR1L69;100;383;98%;0;Fantastico Plus`;

    const result = parsePerformanceCsv(encodeCsv(csv, "iso-8859-1"));

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("Luíz Fernando");
  });

  it("handles DCR as raw decimal and percentage", () => {
    const csv = `Nome;TransporterID;Score;PacotesEntregues;DCR;DNR;Desempenho
A;T1;100;100;0.99;0;F+
B;T2;100;100;99;0;F+
C;T3;100;100;99%;0;F+`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.dcr)).toEqual([0.99, 0.99, 0.99]);
  });

  it("returns errors for invalid rows", () => {
    const csv = `Nome;TransporterID;Score;PacotesEntregues;DCR;DNR;Desempenho
;T1;100;100;99%;0;F+
A;;100;100;99%;0;F+
A;T1;101;100;99%;0;F+
A;T1;100;-1;99%;0;F+
A;T1;100;100;150%;0;F+
A;T1;100;100;99%;x;F+`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(6);
  });

  it("maps scores to classifications correctly", () => {
    const csv = `Nome;TransporterID;Score;PacotesEntregues;DCR;DNR;Desempenho
A;T1;45;100;99%;0;Ruim
B;T2;60;100;99%;0;Razoavel
C;T3;80;100;99%;0;Bom
D;T4;92;100;99%;0;Fantastico
E;T5;98;100;99%;0;Fantastico Plus`;

    const result = parsePerformanceCsv(encodeCsv(csv, "utf-8"));
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.classification)).toEqual([
      "POOR",
      "FAIR",
      "GREAT",
      "FANTASTIC",
      "FANTASTIC_PLUS",
    ]);
  });
});
