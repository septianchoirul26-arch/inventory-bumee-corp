import { format, parseISO } from "date-fns";
import { id } from "date-fns/locale";

export function formatRupiah(value) {
  if (value == null || isNaN(value)) return "—";
  return "Rp" + Math.round(value).toLocaleString("id-ID");
}
export function formatNumber(value) {
  if (value == null || isNaN(value)) return "—";
  return Number(value).toLocaleString("id-ID");
}
function safe(value, fmt) {
  if (!value) return "—";
  try {
    const d = typeof value === "string" ? parseISO(value) : value;
    return format(d, fmt, { locale: id });
  } catch {
    return value;
  }
}
export const formatDate = (v) => safe(v, "dd MMM yyyy");
export const formatDateTime = (v) => safe(v, "dd MMM yyyy HH:mm");
export const formatTime = (v) => safe(v, "HH:mm");
export function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}
export function exportCsv(filename, rows, columns) {
  const header = columns.map((c) => `"${c.label}"`).join(",");
  const lines = rows.map((r) =>
    columns.map((c) => {
      let v = c.value ? c.value(r) : r[c.key];
      if (v == null) v = "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(",")
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
