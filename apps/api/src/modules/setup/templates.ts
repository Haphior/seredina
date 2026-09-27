import type { EmailLanguage } from '@seredina/shared';
import type { TicketPriority } from '@seredina/db';

/**
 * Starting points for a new workspace, by the kind of support it does
 * (docs/adr/0072-first-run-setup.md). Everything a template creates is
 * ordinary tenant data -- renamable, deletable -- so a template is a head
 * start, not a mode. Text is per language because it becomes tenant data in
 * whatever language the workspace runs in.
 */

type Text = Record<EmailLanguage, string>;

interface TemplateMacro {
  name: Text;
  reply: Text;
  /** Status to move the ticket to, by seeded key. */
  status?: 'pending' | 'resolved';
}

interface TemplateCatalogItem {
  name: Text;
  description: Text;
  icon: string;
}

export interface SetupTemplate {
  key: SetupTemplateKey;
  teams: Text[];
  /** Options of the "Category" select field every template adds. */
  categories: Text[];
  /** An extra text field, when the kind of work needs one (e.g. the line or area of a plant). */
  extraField?: { key: string; label: Text };
  sla: Record<TicketPriority, { firstResponse: number; resolution: number }>;
  macros: TemplateMacro[];
  catalog: TemplateCatalogItem[];
}

export const SETUP_TEMPLATE_KEYS = ['it_internal', 'customer_support', 'manufacturing'] as const;
export type SetupTemplateKey = (typeof SETUP_TEMPLATE_KEYS)[number];

const MORE_INFO: TemplateMacro = {
  name: { es: 'Pedir más información', en: 'Ask for more details' },
  reply: {
    es: 'Hola, gracias por escribirnos. Para ayudarte necesitamos un poco más de información: ¿puedes contarnos qué estabas haciendo cuando pasó y, si puedes, enviarnos una captura de pantalla?',
    en: 'Hi, thanks for reaching out. To help you we need a few more details: what were you doing when it happened, and could you send us a screenshot?',
  },
  status: 'pending',
};

const RESOLVED_CONFIRM: TemplateMacro = {
  name: { es: 'Resuelto: confirmar con el usuario', en: 'Resolved: confirm with the requester' },
  reply: {
    es: 'Dejamos resuelto tu caso. Si algo sigue sin funcionar, responde este mensaje y lo reabrimos.',
    en: "We've resolved your request. If anything still isn't working, reply to this message and we'll reopen it.",
  },
  status: 'resolved',
};

const NO_RESPONSE: TemplateMacro = {
  name: { es: 'Cerrar por falta de respuesta', en: 'Close for lack of response' },
  reply: {
    es: 'Como no tuvimos respuesta, damos por cerrado este caso. Si todavía necesitas ayuda, responde este mensaje y lo retomamos.',
    en: "As we haven't heard back, we're closing this request. If you still need help, reply to this message and we'll pick it up again.",
  },
  status: 'resolved',
};

export const SETUP_TEMPLATES: Record<SetupTemplateKey, SetupTemplate> = {
  it_internal: {
    key: 'it_internal',
    teams: [
      { es: 'Soporte N1', en: 'Level 1 support' },
      { es: 'Soporte N2', en: 'Level 2 support' },
      { es: 'Redes e infraestructura', en: 'Networks and infrastructure' },
    ],
    categories: [
      { es: 'Hardware', en: 'Hardware' },
      { es: 'Software', en: 'Software' },
      { es: 'Cuentas y accesos', en: 'Accounts and access' },
      { es: 'Red e internet', en: 'Network and internet' },
      { es: 'Correo', en: 'Email' },
      { es: 'Impresoras', en: 'Printers' },
      { es: 'Otro', en: 'Other' },
    ],
    sla: {
      URGENT: { firstResponse: 15, resolution: 4 * 60 },
      HIGH: { firstResponse: 60, resolution: 8 * 60 },
      NORMAL: { firstResponse: 4 * 60, resolution: 2 * 1440 },
      LOW: { firstResponse: 8 * 60, resolution: 5 * 1440 },
    },
    macros: [
      MORE_INFO,
      {
        name: { es: 'Reiniciar y probar de nuevo', en: 'Restart and try again' },
        reply: {
          es: 'Muchos problemas se resuelven reiniciando el equipo. ¿Puedes reiniciarlo, probar de nuevo y contarnos si sigue pasando?',
          en: 'Many problems go away with a restart. Could you restart the computer, try again and tell us if it still happens?',
        },
        status: 'pending',
      },
      RESOLVED_CONFIRM,
      NO_RESPONSE,
    ],
    catalog: [
      { name: { es: 'Equipo nuevo', en: 'New computer' }, description: { es: 'Notebook o PC para una persona.', en: 'A laptop or desktop for someone.' }, icon: '💻' },
      { name: { es: 'Acceso a un sistema o carpeta', en: 'Access to a system or folder' }, description: { es: 'Permisos para una aplicación, carpeta compartida o sistema.', en: 'Permissions for an application, shared folder or system.' }, icon: '🔑' },
      { name: { es: 'Ingreso de colaborador', en: 'New employee' }, description: { es: 'Cuenta, correo y equipo para alguien que se incorpora.', en: 'Account, email and equipment for someone joining.' }, icon: '👋' },
      { name: { es: 'Instalar software', en: 'Install software' }, description: { es: 'Un programa que necesitas en tu equipo.', en: 'A program you need on your computer.' }, icon: '📦' },
    ],
  },
  customer_support: {
    key: 'customer_support',
    teams: [
      { es: 'Atención al cliente', en: 'Customer service' },
      { es: 'Soporte técnico', en: 'Technical support' },
      { es: 'Facturación', en: 'Billing' },
    ],
    categories: [
      { es: 'Consulta', en: 'Question' },
      { es: 'Reclamo', en: 'Complaint' },
      { es: 'Problema técnico', en: 'Technical problem' },
      { es: 'Facturación y pagos', en: 'Billing and payments' },
      { es: 'Solicitud de cambio', en: 'Change request' },
      { es: 'Otro', en: 'Other' },
    ],
    sla: {
      URGENT: { firstResponse: 30, resolution: 8 * 60 },
      HIGH: { firstResponse: 2 * 60, resolution: 1440 },
      NORMAL: { firstResponse: 8 * 60, resolution: 3 * 1440 },
      LOW: { firstResponse: 1440, resolution: 5 * 1440 },
    },
    macros: [
      {
        name: { es: 'Estamos revisando', en: "We're looking into it" },
        reply: {
          es: 'Gracias por escribirnos. Ya estamos revisando tu caso y te responderemos a la brevedad.',
          en: "Thanks for getting in touch. We're looking into it and will get back to you shortly.",
        },
      },
      MORE_INFO,
      RESOLVED_CONFIRM,
      NO_RESPONSE,
    ],
    catalog: [
      { name: { es: 'Reportar un problema', en: 'Report a problem' }, description: { es: 'Algo no funciona como debería.', en: "Something isn't working as it should." }, icon: '🛠️' },
      { name: { es: 'Consulta de facturación', en: 'Billing question' }, description: { es: 'Dudas sobre una factura, un cobro o un pago.', en: 'Questions about an invoice, a charge or a payment.' }, icon: '🧾' },
      { name: { es: 'Solicitar un cambio', en: 'Request a change' }, description: { es: 'Cambiar datos, un plan o un pedido.', en: 'Change your details, a plan or an order.' }, icon: '✏️' },
    ],
  },
  manufacturing: {
    key: 'manufacturing',
    teams: [
      { es: 'Mantención', en: 'Maintenance' },
      { es: 'TI planta', en: 'Plant IT' },
      { es: 'Calidad', en: 'Quality' },
    ],
    categories: [
      { es: 'Máquina detenida', en: 'Machine down' },
      { es: 'Falla mecánica', en: 'Mechanical fault' },
      { es: 'Falla eléctrica', en: 'Electrical fault' },
      { es: 'Mantención preventiva', en: 'Preventive maintenance' },
      { es: 'Calidad', en: 'Quality' },
      { es: 'Seguridad', en: 'Safety' },
      { es: 'Sistemas y ERP', en: 'Systems and ERP' },
      { es: 'Otro', en: 'Other' },
    ],
    extraField: { key: 'area', label: { es: 'Línea o área', en: 'Line or area' } },
    sla: {
      URGENT: { firstResponse: 10, resolution: 2 * 60 },
      HIGH: { firstResponse: 30, resolution: 8 * 60 },
      NORMAL: { firstResponse: 4 * 60, resolution: 2 * 1440 },
      LOW: { firstResponse: 1440, resolution: 7 * 1440 },
    },
    macros: [
      {
        name: { es: 'Técnico en camino', en: 'Technician on the way' },
        reply: {
          es: 'Recibimos el aviso. Un técnico va en camino a la línea.',
          en: 'We got your report. A technician is on the way to the line.',
        },
      },
      {
        name: { es: 'Esperando repuesto', en: 'Waiting for a spare part' },
        reply: {
          es: 'Identificamos la falla y estamos esperando un repuesto. Te avisamos apenas llegue.',
          en: "We've found the fault and are waiting for a spare part. We'll let you know as soon as it arrives.",
        },
        status: 'pending',
      },
      MORE_INFO,
      RESOLVED_CONFIRM,
    ],
    catalog: [
      { name: { es: 'Reportar falla de máquina', en: 'Report a machine fault' }, description: { es: 'Una máquina o línea con problemas o detenida.', en: 'A machine or line with a problem, or stopped.' }, icon: '⚙️' },
      { name: { es: 'Solicitar mantención', en: 'Request maintenance' }, description: { es: 'Mantención programada o un trabajo en planta.', en: 'Scheduled maintenance or a job on the floor.' }, icon: '🔧' },
      { name: { es: 'Reportar incidente de seguridad', en: 'Report a safety incident' }, description: { es: 'Un accidente, casi accidente o condición insegura.', en: 'An accident, near miss or unsafe condition.' }, icon: '🦺' },
      { name: { es: 'Soporte de sistemas', en: 'Systems support' }, description: { es: 'ERP, computadores, impresoras o red de la planta.', en: 'ERP, computers, printers or the plant network.' }, icon: '🖥️' },
    ],
  },
};
