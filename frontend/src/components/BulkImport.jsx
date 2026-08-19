import { useState } from "react";
import api, { apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatRupiah, formatNumber } from "@/lib/format";
import { UploadSimple, ClipboardText, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Generic bulk importer with paste + file (Excel/CSV) support and validation preview.
 * props:
 *  - fields: [{key, label}] positional mapping for pasted rows
 *  - validate: async (rows) => { preview, valid_count, error_count }
 *  - onCommit: async (validRows) => void   (validRows = preview rows with status "valid")
 *  - previewColumns: [{key, label, render?, money?, num?}]
 *  - hint: string
 */
export default function BulkImport({ fields, validate, onCommit, previewColumns, hint }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [counts, setCounts] = useState({ valid: 0, error: 0 });
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);

  const parsePaste = (raw) => {
    const lines = raw.trim().split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const delim = lines[0].includes("\t") ? "\t" : ",";
    let start = 0;
    const firstCells = lines[0].split(delim).map((c) => c.trim().toLowerCase());
    if (fields.some((f) => firstCells.includes(f.key) || firstCells.includes(f.label.toLowerCase()))) start = 1;
    const rows = [];
    for (let i = start; i < lines.length; i++) {
      const cells = lines[i].split(delim).map((c) => c.trim());
      const obj = {};
      fields.forEach((f, idx) => { obj[f.key] = cells[idx]; });
      rows.push(obj);
    }
    return rows;
  };

  const runValidate = async (rows) => {
    if (!rows.length) { toast.error("No rows detected"); return; }
    setLoading(true);
    try {
      const res = await validate(rows);
      setPreview(res.preview);
      setCounts({ valid: res.valid_count, error: res.error_count });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = () => runValidate(parsePaste(text));

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/import/parse-file", fd, { headers: { "Content-Type": "multipart/form-data" } });
      await runValidate(data.rows);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const handleCommit = async () => {
    const validRows = preview.filter((p) => p.status === "valid");
    if (!validRows.length) { toast.error("No valid rows to save"); return; }
    setCommitting(true);
    try {
      await onCommit(validRows);
      setPreview(null);
      setText("");
      setCounts({ valid: 0, error: 0 });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            <ClipboardText size={14} /> Paste tabular data
          </div>
          <Textarea
            data-testid="bulk-paste-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={hint}
            className="font-data text-[13px] h-32 rounded-sm"
          />
          <Button data-testid="bulk-parse-paste-btn" onClick={handlePaste} disabled={loading} className="mt-2 h-8 rounded-sm" size="sm">
            Parse & Validate
          </Button>
        </div>
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            <UploadSimple size={14} /> Upload Excel / CSV
          </div>
          <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-slate-200 rounded-sm cursor-pointer hover:bg-slate-50">
            <UploadSimple size={24} className="text-slate-400 mb-1" />
            <span className="text-sm text-slate-500">Click to choose .xlsx or .csv</span>
            <input data-testid="bulk-file-input" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          </label>
        </div>
      </div>

      {preview && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-[#15803D] font-semibold"><CheckCircle size={16} weight="fill" /> {counts.valid} valid</span>
            <span className={cn("flex items-center gap-1 font-semibold", counts.error ? "text-[#B91C1C]" : "text-slate-400")}>
              <WarningCircle size={16} weight="fill" /> {counts.error} error{counts.error !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="border border-slate-200 rounded-sm overflow-auto max-h-96">
            <table className="ims-table w-full">
              <thead className="sticky top-0">
                <tr>
                  {previewColumns.map((c) => <th key={c.key} className={c.money || c.num ? "text-right" : ""}>{c.label}</th>)}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className={row.status === "error" ? "bg-[#FEE2E2]/40" : ""} data-testid={`bulk-preview-row-${i}`}>
                    {previewColumns.map((c) => (
                      <td key={c.key} className={cn(c.money || c.num ? "text-right font-data" : c.mono ? "font-data" : "")}>
                        {c.render ? c.render(row) : c.money ? (row[c.key] != null ? formatRupiah(row[c.key]) : "—") : c.num ? (row[c.key] != null ? formatNumber(row[c.key]) : "—") : (row[c.key] ?? "—")}
                      </td>
                    ))}
                    <td>
                      {row.status === "valid" ? (
                        <span className="text-[#15803D] text-xs font-semibold">Valid</span>
                      ) : (
                        <span className="text-[#B91C1C] text-xs font-semibold">{row.error}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8 rounded-sm" onClick={() => setPreview(null)}>Clear</Button>
            <Button
              data-testid="bulk-confirm-btn"
              size="sm"
              className="h-8 rounded-sm"
              disabled={counts.error > 0 || counts.valid === 0 || committing}
              onClick={handleCommit}
            >
              {committing ? "Saving..." : `Confirm ${counts.valid} row(s)`}
            </Button>
          </div>
          {counts.error > 0 && (
            <p className="text-xs text-[#B45309]">Resolve all errors before saving. Invalid rows are never imported silently.</p>
          )}
        </div>
      )}
    </div>
  );
}
