import { useState, useRef } from "react";
import api, { apiError } from "@/lib/api";
import { toast } from "sonner";
import { UploadSimple, X } from "@phosphor-icons/react";

export default function PhotoUpload({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  const backend = process.env.REACT_APP_BACKEND_URL;
  const src = value ? (value.startsWith("http") ? value : `${backend}${value}`) : null;

  const handle = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/upload-photo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange(data.url);
      toast.success("Foto diunggah");
    } catch (err) { toast.error(apiError(err)); }
    finally { setUploading(false); if (ref.current) ref.current.value = ""; }
  };

  return (
    <div className="flex items-center gap-3">
      {src ? (
        <div className="relative">
          <img src={src} alt="produk" className="w-16 h-16 rounded-sm object-cover border border-slate-200" data-testid="photo-preview" />
          <button type="button" onClick={() => onChange("")} className="absolute -top-2 -right-2 bg-slate-900 text-white rounded-full w-5 h-5 flex items-center justify-center"><X size={12} /></button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center w-16 h-16 border-2 border-dashed border-slate-200 rounded-sm cursor-pointer hover:bg-slate-50">
          <UploadSimple size={18} className="text-slate-400" />
          <input ref={ref} type="file" accept="image/*" onChange={handle} className="hidden" data-testid="photo-input" />
        </label>
      )}
      <span className="text-xs text-slate-500">{uploading ? "Mengunggah..." : "JPG/PNG/WebP"}</span>
    </div>
  );
}
