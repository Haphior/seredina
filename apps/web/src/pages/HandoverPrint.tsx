import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { apiGet, API_URL, ApiError } from '../lib/api';
import type { AssetHandoverDetail } from '../lib/types';

/**
 * The handover form (acta de entrega / devolución) to print and sign --
 * docs/adr/0078-mobile-inventory.md. Outside the console's layout so the
 * page prints as just the form; the company logo is the one uploaded for
 * customer emails.
 */
export function HandoverPrint() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [h, setH] = useState<AssetHandoverDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logo, setLogo] = useState(true);

  useEffect(() => {
    apiGet<AssetHandoverDetail>(`/handovers/${id}`)
      .then(setH)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('handovers.loadFailed')));
  }, [id]);

  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (!h) return <div className="p-6 text-sm text-slate-500">{t('common.loading')}</div>;

  const delivery = h.kind === 'DELIVERY';
  const date = new Date(`${h.handedOverOn.slice(0, 10)}T12:00:00`).toLocaleDateString(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const person = h.contact?.name ?? '—';
  const staff = h.recordedByName ?? '';
  const brandModel = [h.asset.manufacturer, h.asset.model].filter(Boolean).join(' ');

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[800px] items-center justify-between px-4 print:hidden">
        <Link to={`/assets/${h.asset.id}`} className="text-[13px] font-medium text-slate-500 hover:text-slate-700">
          ← {h.asset.name}
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-indigo-700"
        >
          {t('handovers.printNow')}
        </button>
      </div>

      <article className="mx-auto max-w-[800px] bg-white px-12 py-10 text-[13px] leading-relaxed text-slate-800 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="mb-8 flex items-start justify-between gap-6 border-b border-slate-300 pb-5">
          <div>
            <h1 className="text-[20px] font-bold text-slate-900">{t(delivery ? 'handovers.form.titleDelivery' : 'handovers.form.titleReturn')}</h1>
            <p className="text-slate-500">{h.tenantName}</p>
          </div>
          {logo && h.tenantSlug && (
            <img
              src={`${API_URL}/public/${h.tenantSlug}/email-images/logo`}
              alt=""
              className="max-h-14 max-w-[180px] object-contain"
              onError={() => setLogo(false)}
            />
          )}
        </header>

        <p className="mb-6">
          {t(delivery ? 'handovers.form.introDelivery' : 'handovers.form.introReturn', { date, company: h.tenantName, person })}
        </p>

        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">{t('handovers.form.equipment')}</h2>
        <table className="mb-6 w-full border-collapse text-left">
          <tbody>
            <Row label={t('handovers.form.type')} value={t(`assetType.${h.asset.assetType}`)} />
            <Row label={t('handovers.form.name')} value={h.asset.name} />
            <Row label={t('handovers.form.brandModel')} value={brandModel || null} />
            <Row label={t('handovers.form.serial')} value={h.asset.serialNumber} />
            {h.asset.imei && <Row label="IMEI" value={h.asset.imei} />}
            <Row label={t('handovers.form.assetTag')} value={h.asset.assetTag} />
            <Row label={t('handovers.form.accessories')} value={h.accessories} />
            <Row label={t('handovers.form.condition')} value={h.condition} />
          </tbody>
        </table>

        {h.mobileLine && (
          <>
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">{t('handovers.form.line')}</h2>
            <table className="mb-6 w-full border-collapse text-left">
              <tbody>
                <Row label={t('handovers.form.phoneNumber')} value={h.mobileLine.phoneNumber} />
                <Row label={t('handovers.form.carrier')} value={h.mobileLine.carrier?.name ?? null} />
                <Row label={t('handovers.form.plan')} value={h.mobileLine.plan} />
                <Row label="ICCID" value={h.mobileLine.iccid} />
              </tbody>
            </table>
          </>
        )}

        {h.notes && (
          <>
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-slate-500">{t('handovers.form.notes')}</h2>
            <p className="mb-6 whitespace-pre-line">{h.notes}</p>
          </>
        )}

        <p className="mb-16">{t(delivery ? 'handovers.form.statementDelivery' : 'handovers.form.statementReturn')}</p>

        <div className="grid grid-cols-2 gap-16">
          <Signature
            role={t(delivery ? 'handovers.form.handedBy' : 'handovers.form.returnedBy')}
            name={delivery ? staff : person}
          />
          <Signature
            role={t(delivery ? 'handovers.form.receivedBy' : 'handovers.form.receivedBackBy')}
            name={delivery ? person : staff}
          />
        </div>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <tr className="border-b border-slate-200">
      <th className="w-1/3 py-1.5 pr-4 align-top font-semibold text-slate-600">{label}</th>
      <td className="py-1.5">{value || '—'}</td>
    </tr>
  );
}

function Signature({ role, name }: { role: string; name: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-1 h-12 border-b border-slate-500" />
      <div className="font-semibold">{role}</div>
      <div className="text-slate-600">
        {t('handovers.form.signName')}: {name}
      </div>
      <div className="text-slate-600">{t('handovers.form.signId')}:</div>
    </div>
  );
}
