import * as XLSX from "xlsx";

const TEMPLATE_HEADERS = [
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
];

const FILENAME = "DA_Disponibilidade_modelo.xlsx";

/**
 * Gera o arquivo-modelo em branco para preenchimento das disponibilidades.
 * Retorna um ArrayBuffer que pode ser servido diretamente como download.
 */
export function downloadAvailabilityTemplate(): { buffer: ArrayBuffer; filename: string } {
  const worksheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Respostas");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const view = new Uint8Array(bytes);
  return { buffer: view.buffer as ArrayBuffer, filename: FILENAME };
}
