import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A QR code drawn in the browser -- nothing it encodes leaves the page. */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) return <div style={{ width: size, height: size }} className="rounded-md bg-slate-50" />;
  return <img src={src} width={size} height={size} alt={label} className="rounded-md border border-slate-200 bg-white" />;
}
